import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { partir } from '../hooks/bloques'
import { MUESTRA } from '../hooks/portapapeles'

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

const MENSAJE = 'Ejecuta esta consulta:\n\n```sql\nSELECT TOP 5 *\nFROM clientes;\n```\n\nY después esta:\n\n```bash\nls\n```'

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
  expect(copiado).toEqual(['SELECT TOP 5 *\nFROM clientes;', 'ls'])
})

type Llamada = { argv: string[]; stdin: string; env?: Record<string, string>; timeoutMs?: number }

// El programa que corre de verdad: xclip va envuelto en `sh -c` para soltar su salida.
const programa = (argv: readonly string[]) => (argv[0] === 'sh' ? argv[2]!.split(' ')[0]! : argv[0]!)

// Un equipo donde solo existen las herramientas de `hay` y las variables de `vars`; ui.copy (OSC 52) no copia
// y los avisos quedan en `avisos`. `sh` siempre existe: xclip ausente sale con 127, como en la realidad.
// `responder` contesta en lugar del equipo a los comandos que quiera (lo demás sale bien y sin salida).
type Respuesta = { exitCode: number; stdout: string; stderr: string }
function equipo(
  on: On,
  hay: string[],
  llamadas: Llamada[],
  vars: Record<string, string> = {},
  avisos: string[] = [],
  responder: (argv: readonly string[]) => Respuesta | undefined = () => undefined,
): void {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="motor">⏺ {e.props.text}</Text>
  })
  on('env.get', ($, e) => ({ value: vars[e.name] }) as never)
  on('ui.copy', () => ({ value: { isCopied: false } }) as never)
  on('ui.toast', ($, e) => {
    avisos.push(e.text)
    return { value: undefined } as never
  })
  on('process.run', ($, e) => {
    const prog = programa(e.argv)
    const propia = responder(e.argv)
    if (propia) return { value: propia } as never
    if (!hay.includes(prog)) {
      if (e.argv[0] === 'sh') return { value: { exitCode: 127, stdout: '', stderr: '' } } as never
      throw new Error(`${prog}: no existe`)
    }
    llamadas.push({ argv: [...e.argv], stdin: e.init?.stdin ?? '', env: e.init?.env, timeoutMs: e.init?.timeoutMs })
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
}

const TILDES = '```text\nCanción de acción: ñandú, pingüino, ¿qué? ¡sí!\n```'

test('en macOS pbcopy recibe un idioma UTF-8 para no dañar las tildes', async ($, on) => {
  const llamadas: Llamada[] = []
  equipo(on, ['pbcopy'], llamadas)
  const ui = await $.ui.mount({ plugin: 'copiar', surface: 'terminal', component: 'AssistantMessage', props: { text: TILDES, isFirstOfReply: true } as never })
  await ui.press({ key: 'copiar-0' })
  await ui.unmount()
  expect(llamadas).toHaveLength(1)
  expect(llamadas[0]!.stdin).toBe('Canción de acción: ñandú, pingüino, ¿qué? ¡sí!')
  expect(llamadas[0]!.env?.LC_ALL).toBe('en_US.UTF-8')
})

test('en Windows copia con PowerShell en UTF-8, nunca con clip.exe', async ($, on) => {
  const llamadas: Llamada[] = []
  equipo(on, ['powershell.exe', 'clip.exe', 'clip', 'wl-copy', 'xsel'], llamadas, { OS: 'Windows_NT' })
  const ui = await $.ui.mount({ plugin: 'copiar', surface: 'terminal', component: 'AssistantMessage', props: { text: TILDES, isFirstOfReply: true } as never })
  await ui.press({ key: 'copiar-0' })
  await ui.unmount()
  expect(llamadas.map(l => l.argv[0])).toEqual(['powershell.exe'])
  expect(llamadas[0]!.argv.join(' ')).toContain('UTF8.GetString')
  expect(llamadas[0]!.stdin).toBe('Canción de acción: ñandú, pingüino, ¿qué? ¡sí!')
  // powershell.exe 5.1 tarda en arrancar en frío: tiene más tiempo que el resto.
  expect(llamadas[0]!.timeoutMs).toBe(10_000)
})

const BLOQUE = '```bash\nls\n```'

async function pulsar($: Engine, texto = BLOQUE): Promise<void> {
  const ui = await $.ui.mount({ plugin: 'copiar', surface: 'terminal', component: 'AssistantMessage', props: { text: texto, isFirstOfReply: true } as never })
  await ui.press({ key: 'copiar-0' })
  await ui.unmount()
}

test('en X11 prueba xsel antes que xclip', async ($, on) => {
  const llamadas: Llamada[] = []
  const avisos: string[] = []
  equipo(on, ['xsel', 'xclip'], llamadas, { DISPLAY: ':0' }, avisos)
  await pulsar($)
  expect(llamadas.map(l => programa(l.argv))).toEqual(['xsel'])
  expect(llamadas[0]!.argv).toEqual(['xsel', '--clipboard', '--input'])
  expect(llamadas[0]!.timeoutMs).toBe(5000)
  expect(avisos).toEqual(['Copiado: 1 línea de bash.'])
})

test('xclip suelta su salida para no hacer esperar al botón hasta el timeout', async ($, on) => {
  const llamadas: Llamada[] = []
  const avisos: string[] = []
  equipo(on, ['xclip'], llamadas, { DISPLAY: ':0' }, avisos)
  await pulsar($)
  expect(llamadas).toHaveLength(1)
  expect(llamadas[0]!.argv).toEqual(['sh', '-c', 'xclip -selection clipboard >/dev/null 2>&1'])
  expect(llamadas[0]!.stdin).toBe('ls')
  expect(avisos).toEqual(['Copiado: 1 línea de bash.'])
})

test('en Wayland usa wl-copy', async ($, on) => {
  const llamadas: Llamada[] = []
  equipo(on, ['wl-copy', 'xsel', 'xclip'], llamadas, { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' })
  await pulsar($)
  expect(llamadas.map(l => l.argv[0])).toEqual(['wl-copy'])
})

test('en WSL copia al portapapeles de Windows con powershell.exe', async ($, on) => {
  const llamadas: Llamada[] = []
  equipo(on, ['powershell.exe', 'wl-copy'], llamadas, { WSL_DISTRO_NAME: 'Ubuntu', WAYLAND_DISPLAY: 'wayland-0' })
  await pulsar($)
  expect(llamadas.map(l => l.argv[0])).toEqual(['powershell.exe'])
})

test('si no puede copiar, el aviso dice qué hacer en ese sistema', async ($, on) => {
  const avisos: string[] = []
  equipo(on, [], [], { OS: 'Windows_NT' }, avisos)
  await pulsar($)
  expect(avisos).toHaveLength(1)
  expect(avisos[0]).toContain('PowerShell')
  expect(avisos[0]).not.toContain('wl-clipboard')
  expect(avisos[0]).not.toContain('xclip')
})

test('en X11 sin herramientas, el aviso pide xsel', async ($, on) => {
  const avisos: string[] = []
  equipo(on, [], [], { DISPLAY: ':0' }, avisos)
  await pulsar($)
  expect(avisos[0]).toContain('instala xsel')
})

test('en Wayland sin herramientas, el aviso pide wl-clipboard', async ($, on) => {
  const avisos: string[] = []
  equipo(on, [], [], { WAYLAND_DISPLAY: 'wayland-0' }, avisos)
  await pulsar($)
  expect(avisos[0]).toContain('wl-clipboard')
})

test('el diagnóstico dice el sistema, qué herramienta copió y lee la prueba de vuelta', async ($, on) => {
  const llamadas: Llamada[] = []
  equipo(on, ['xclip'], llamadas, { DISPLAY: ':0' }, [], argv => (argv.includes('-o') ? { exitCode: 0, stdout: MUESTRA, stderr: '' } : undefined))
  const { text } = await $.command.run({ command: 'copiar-diagnostico' } as never)
  expect(text).toContain('Linux con X11 (DISPLAY=:0)')
  expect(text).toContain('✘ xsel: no está instalado')
  expect(text).toContain('✔ xclip: copió el texto de prueba')
  expect(text).toContain('✔ Prueba de copia')
  expect(text).toContain('El botón Copiar usa xclip')
})

test('el diagnóstico en Windows avisa de PowerShell restringido', async ($, on) => {
  equipo(on, [], [], { OS: 'Windows_NT' }, [], argv =>
    argv.join(' ').includes('LanguageMode')
      ? { exitCode: 0, stdout: 'ConstrainedLanguage\r\n', stderr: '' }
      : { exitCode: 1, stdout: '', stderr: 'No se puede invocar el método. Solo se admite en tipos principales.' },
  )
  const { text } = await $.command.run({ command: 'copiar-diagnostico' } as never)
  expect(text).toContain('Sistema: Windows')
  expect(text).toContain('✘ powershell.exe: salió con código 1')
  expect(text).toContain('✘ Ninguna herramienta pudo copiar')
  expect(text).toContain('OSC 52')
  expect(text).toContain('modo ConstrainedLanguage')
  expect(text).not.toContain('wl-clipboard')
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
