import type { Register, RenderElement } from 'claude-code'

import { partir } from './bloques'
import type { Trozo } from './bloques'
import { consejo, copiar, diagnosticar } from './portapapeles'

// Lo que Claude lee en cada sesión: así lo que es para copiar llega en un bloque.
const INSTRUCCION =
  'Cuando le des a la persona algo para copiar y pegar (un comando, una consulta SQL, un texto para enviar, ' +
  'una ruta, una configuración, un valor), ponlo solo en su propio bloque de código cercado con ``` y el lenguaje ' +
  'si lo tiene, sin explicaciones dentro: la terminal dibuja cada bloque en un recuadro con un botón «Copiar» que ' +
  'copia el contenido exacto del bloque. Lo que no es para copiar va fuera de los bloques.'

const lineas = (n: number) => (n === 1 ? '1 línea' : `${n} líneas`)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'copiar-diagnostico', description: 'Revisa qué usa el botón Copiar en este equipo y hace una copia de prueba' })
    await $.tool.register({
      name: 'diagnostico',
      description:
        'Revisa el mod Copiar en este equipo: sistema detectado, qué herramienta de portapapeles encuentra (wl-copy, xsel, xclip, PowerShell) ' +
        'y hace una copia de prueba (deja un texto de prueba en el portapapeles). Úsala al instalar el mod (INSTALAR.md) o cuando el botón Copiar falla.',
      inputSchema: { type: 'object', properties: {} },
    })
    return next(e)
  })

  on('command.run', { command: 'copiar-diagnostico' }, async $ => ({ text: await diagnosticar($) }))

  on('tool.call', { tool: 'mcp__copiar__diagnostico' as never }, async $ => ({ result: await diagnosticar($) })).catch(() => ({
    result: 'El diagnóstico falló dentro del mod. Ejecuta claude plugin validate sobre la carpeta del mod.',
  }))

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { sections: [...r.sections, { id: 'copiar:bloques', text: INSTRUCCION, scope: 'session' }] }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const trozos = partir(e.props.text)
    if (e.props.isSummary || !trozos.some(t => t.tipo === 'codigo')) return next(e)
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)

    const recuadro = (t: Extract<Trozo, { tipo: 'codigo' }>, i: number, margen = 2): RenderElement => {
      const cabecera: RenderElement[] = [
        <Text dimColor>
          {t.lenguaje || 'texto'} · {lineas(t.codigo.split('\n').length)}
          {t.abierto ? ' · escribiendo…' : ''}
        </Text>,
      ]
      if (!t.abierto) {
        cabecera.push(
          <Button
            key={`copiar-${i}`}
            label="Copiar"
            variant="primary"
            onPress={async press => {
              const { ok, sistema } = await copiar($, t.codigo, press.surface)
              $.ui.toast(ok ? `Copiado: ${lineas(t.codigo.split('\n').length)}${t.lenguaje ? ` de ${t.lenguaje}` : ''}.` : `No pude copiar: ${consejo(sistema)}`)
            }}
          />,
        )
      }
      return (
        <Box key={`bloque-${i}`} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginLeft={margen} flexGrow={1}>
          <Box flexDirection="row" justifyContent="space-between">
            {cabecera}
          </Box>
          <Markdown text={'```' + t.lenguaje + '\n' + t.codigo + '\n```'} />
        </Box>
      )
    }

    const hijos: RenderElement[] = []
    for (const [i, t] of trozos.entries()) {
      if (t.tipo === 'codigo') {
        // Una respuesta que abre con un bloque conserva su viñeta, al lado del recuadro.
        hijos.push(
          i === 0 && e.props.isFirstOfReply ? (
            <Box key="vineta" flexDirection="row">
              <Text>⏺ </Text>
              {recuadro(t, i, 0)}
            </Box>
          ) : (
            recuadro(t, i)
          ),
        )
      } else if (i === 0) {
        // El primer texto lo dibuja el motor: viñeta, sangría y colores de siempre.
        hijos.push(await next({ ...e, props: { ...e.props, text: t.texto } }))
      } else {
        hijos.push(
          <Box key={`texto-${i}`} paddingLeft={2}>
            <Markdown text={t.texto} />
          </Box>,
        )
      }
    }
    return (
      <Box flexDirection="column" gap={1}>
        {hijos}
      </Box>
    )
  })
}
