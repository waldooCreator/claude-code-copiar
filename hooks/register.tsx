import type { EngineInterface, Register, RenderElement, RenderSurface } from 'claude-code'

import { partir } from './bloques'
import type { Trozo } from './bloques'

// Lo que Claude lee en cada sesión: así lo que es para copiar llega en un bloque.
const INSTRUCCION =
  'Cuando le des a la persona algo para copiar y pegar (un comando, una consulta SQL, un texto para enviar, ' +
  'una ruta, una configuración, un valor), ponlo solo en su propio bloque de código cercado con ``` y el lenguaje ' +
  'si lo tiene, sin explicaciones dentro: la terminal dibuja cada bloque en un recuadro con un botón «Copiar» que ' +
  'copia el contenido exacto del bloque. Lo que no es para copiar va fuera de los bloques.'

// Muchas terminales (Ptyxis/VTE entre ellas) no dejan copiar por OSC 52:
// primero las herramientas del sistema, y $.ui.copy de respaldo.
const COPIAR: string[][] = [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input'], ['pbcopy'], ['clip.exe'], ['clip']]

async function copiar($: EngineInterface, texto: string, superficie: RenderSurface): Promise<boolean> {
  if (superficie === 'terminal') {
    for (const argv of COPIAR) {
      try {
        if ((await $.process.run(argv, { stdin: texto, timeoutMs: 5000 })).exitCode === 0) return true
      } catch {
        // esa herramienta no existe aquí: la siguiente
      }
    }
  }
  try {
    return (await $.ui.copy({ text: texto, surface: superficie })).isCopied
  } catch {
    return false
  }
}

const lineas = (n: number) => (n === 1 ? '1 línea' : `${n} líneas`)

export const register: Register = on => {
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
              const ok = await copiar($, t.codigo, press.surface)
              $.ui.toast(ok ? `Copiado: ${lineas(t.codigo.split('\n').length)}${t.lenguaje ? ` de ${t.lenguaje}` : ''}.` : 'No pude copiar: instala wl-clipboard (Wayland) o xclip (X11).')
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
