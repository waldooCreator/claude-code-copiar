import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { partir } from '../hooks/bloques'

describe('partir', () => {
  test('separa el texto de los bloques cercados', () => {
    expect(partir('Corre esto:\n\n```bash\nls -la\n```\n\nY listo.')).toEqual([
      { tipo: 'texto', texto: 'Corre esto:' },
      { tipo: 'codigo', lenguaje: 'bash', codigo: 'ls -la', abierto: false },
      { tipo: 'texto', texto: 'Y listo.' },
    ])
  })
  test('un bloque dentro de una lista pierde la sangría al copiarse', () => {
    expect(partir('1. Abre:\n   ```sql\n   SELECT 1\n     FROM t\n   ```')[1]).toEqual({ tipo: 'codigo', lenguaje: 'sql', codigo: 'SELECT 1\n  FROM t', abierto: false })
  })
  test('un bloque sin cerrar (la respuesta se está escribiendo) queda abierto', () => {
    expect(partir('```\nuno\ndos')).toEqual([{ tipo: 'codigo', lenguaje: '', codigo: 'uno\ndos', abierto: true }])
  })
  test('una valla más larga no se cierra con una más corta', () => {
    expect(partir('````md\n```\nadentro\n```\n````')).toEqual([{ tipo: 'codigo', lenguaje: 'md', codigo: '```\nadentro\n```', abierto: false }])
  })
  test('sin bloques, todo es texto', () => {
    expect(partir('Hola **mundo**')).toEqual([{ tipo: 'texto', texto: 'Hola **mundo**' }])
  })
})

// El motor bajo el mod: dibuja el mensaje como texto plano y copia con wl-copy.
function motor(on: On, copiado: string[]): void {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="motor">⏺ {e.props.text}</Text>
  })
  on('process.run', ($, e) => {
    if (e.argv[0] === 'wl-copy') copiado.push(e.init?.stdin ?? '')
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
}

const MENSAJE = 'Ejecuta esta consulta:\n\n```sql\nSELECT TOP 5 *\nFROM TblTerceros;\n```\n\nY después esta:\n\n```bash\nls\n```'

test('cada bloque sale en un recuadro con Copiar, y Copiar copia el bloque exacto', async ($, on) => {
  const copiado: string[] = []
  motor(on, copiado)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'copiar', surface, component: 'AssistantMessage', props: { text: MENSAJE, isFirstOfReply: true } as never })
    expect(await ui.find({ text: /Ejecuta esta consulta/ })).toBeDefined()
    expect(await ui.find({ text: /sql · 2 líneas/ })).toBeDefined()
    expect(await ui.find({ text: /Y después esta/ })).toBeDefined()
    await ui.press({ key: 'copiar-1' })
    await ui.press({ key: 'copiar-3' })
    await ui.unmount()
  }
  // En la terminal copia wl-copy; en el escritorio, el portapapeles de la superficie.
  expect(copiado).toEqual(['SELECT TOP 5 *\nFROM TblTerceros;', 'ls'])
})

// Un equipo donde solo existen las herramientas de `hay`; las demás no se encuentran.
function equipo(on: On, hay: string[], llamadas: { argv: string[]; stdin: string; env?: Record<string, string> }[]): void {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="motor">⏺ {e.props.text}</Text>
  })
  on('process.run', ($, e) => {
    if (!hay.includes(e.argv[0]!)) throw new Error(`${e.argv[0]}: no existe`)
    llamadas.push({ argv: [...e.argv], stdin: e.init?.stdin ?? '', env: e.init?.env })
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
}

const TILDES = '```text\nCanción de acción: ñandú, pingüino, ¿qué? ¡sí!\n```'

test('en macOS pbcopy recibe un idioma UTF-8 para no dañar las tildes', async ($, on) => {
  const llamadas: { argv: string[]; stdin: string; env?: Record<string, string> }[] = []
  equipo(on, ['pbcopy'], llamadas)
  const ui = await $.ui.mount({ plugin: 'copiar', surface: 'terminal', component: 'AssistantMessage', props: { text: TILDES, isFirstOfReply: true } as never })
  await ui.press({ key: 'copiar-0' })
  await ui.unmount()
  expect(llamadas).toHaveLength(1)
  expect(llamadas[0]!.stdin).toBe('Canción de acción: ñandú, pingüino, ¿qué? ¡sí!')
  expect(llamadas[0]!.env?.LC_ALL).toBe('en_US.UTF-8')
})

test('en Windows copia con PowerShell en UTF-8, nunca con clip.exe', async ($, on) => {
  const llamadas: { argv: string[]; stdin: string; env?: Record<string, string> }[] = []
  equipo(on, ['powershell.exe', 'clip.exe', 'clip'], llamadas)
  const ui = await $.ui.mount({ plugin: 'copiar', surface: 'terminal', component: 'AssistantMessage', props: { text: TILDES, isFirstOfReply: true } as never })
  await ui.press({ key: 'copiar-0' })
  await ui.unmount()
  expect(llamadas.map(l => l.argv[0])).toEqual(['powershell.exe'])
  expect(llamadas[0]!.argv.join(' ')).toContain('UTF8.GetString')
  expect(llamadas[0]!.stdin).toBe('Canción de acción: ñandú, pingüino, ¿qué? ¡sí!')
})

test('un bloque que todavía se está escribiendo no tiene botón', async ($, on) => {
  motor(on, [])
  const ui = await $.ui.mount({ plugin: 'copiar', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Mira:\n```sql\nSELECT', isFirstOfReply: true } as never })
  expect(await ui.find({ text: /escribiendo/ })).toBeDefined()
  expect(await ui.find({ key: 'copiar-1' })).toBeUndefined()
  await ui.unmount()
})

test('una respuesta sin bloques se dibuja como siempre', async ($, on) => {
  motor(on, [])
  const ui = await $.ui.mount({ plugin: 'copiar', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Hola, sin código.', isFirstOfReply: true } as never })
  expect(await ui.find({ text: /⏺ Hola, sin código/ })).toBeDefined()
  expect(await ui.find({ text: /Copiar/ })).toBeUndefined()
  await ui.unmount()
})

test('la instrucción para Claude se agrega al final del prompt de sistema', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'Eres Claude.', scope: 'shared' }] }) as never)
  const r = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)
  expect(r.sections.map(s => s.id)).toEqual(['intro', 'copiar:bloques'])
  expect(r.sections[1]!.text).toContain('Copiar')
})
