// Copiar al portapapeles del sistema en Linux, Windows (y WSL) y macOS,
// con el portapapeles de la terminal (OSC 52) de respaldo; y el diagnóstico.

import type { EngineInterface, RenderSurface } from 'claude-code'

/** Dónde corre Claude Code, leído de variables de entorno (sin ejecutar nada). */
export type Sistema = 'windows' | 'wsl' | 'wayland' | 'x11' | 'otro'

export type Herramienta = {
  nombre: string
  argv: string[]
  env?: Record<string, string>
  timeoutMs: number
  /** Cómo leer el portapapeles de vuelta, para la prueba del diagnóstico. */
  leer: string[]
}

// Windows: clip.exe lee la entrada en la página de códigos de la consola y daña
// las tildes; PowerShell lee los bytes tal cual y los decodifica como UTF-8.
const PS_COPIAR =
  '$m = New-Object IO.MemoryStream; [Console]::OpenStandardInput().CopyTo($m); ' +
  'Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString($m.ToArray()))'
const PS_LEER = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw'
// Sin un idioma UTF-8, pbcopy lee la entrada como MacRoman y daña las tildes.
const UTF8 = { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }
// powershell.exe 5.1 tarda varios segundos en arrancar en frío: más margen que el resto.
const LENTO = 10_000
const NORMAL = 5_000

const powershell = (exe: string): Herramienta => ({
  nombre: exe,
  argv: [exe, '-NoProfile', '-NonInteractive', '-Command', PS_COPIAR],
  timeoutMs: LENTO,
  leer: [exe, '-NoProfile', '-NonInteractive', '-Command', PS_LEER],
})

const WL_COPY: Herramienta = { nombre: 'wl-copy', argv: ['wl-copy'], timeoutMs: NORMAL, leer: ['wl-paste', '--no-newline'] }
// xsel se desprende del todo (cierra su salida) y $.process.run vuelve en el acto.
const XSEL: Herramienta = { nombre: 'xsel', argv: ['xsel', '--clipboard', '--input'], timeoutMs: NORMAL, leer: ['xsel', '--clipboard', '--output'] }
// xclip se queda en segundo plano sirviendo el texto con la salida heredada abierta, y $.process.run
// (que no tiene opción para no capturarla) esperaría al timeout: se manda a /dev/null con sh; 127 = no instalado.
const XCLIP: Herramienta = {
  nombre: 'xclip',
  argv: ['sh', '-c', 'xclip -selection clipboard >/dev/null 2>&1'],
  timeoutMs: NORMAL,
  leer: ['xclip', '-selection', 'clipboard', '-o'],
}
const PBCOPY: Herramienta = { nombre: 'pbcopy', argv: ['pbcopy'], env: UTF8, timeoutMs: NORMAL, leer: ['pbpaste'] }
const POWERSHELL_EXE = powershell('powershell.exe')
const PWSH = powershell('pwsh')

/** Las herramientas que se prueban en cada sistema, en orden. */
export function herramientas(sistema: Sistema): Herramienta[] {
  switch (sistema) {
    case 'windows':
      return [POWERSHELL_EXE, PWSH]
    // En WSL el portapapeles que importa es el de Windows: powershell.exe responde desde ahí.
    case 'wsl':
      return [POWERSHELL_EXE, WL_COPY, XSEL, XCLIP]
    // Con Wayland, xsel y xclip sirven a través de XWayland si falta wl-clipboard.
    case 'wayland':
      return [WL_COPY, XSEL, XCLIP]
    case 'x11':
      return [XSEL, XCLIP]
    default:
      return [WL_COPY, XSEL, XCLIP, PBCOPY, POWERSHELL_EXE, PWSH]
  }
}

const valor = (p: Promise<string | undefined>) => p.catch(() => undefined)

export async function detectar($: EngineInterface): Promise<{ sistema: Sistema; como: string }> {
  if ((await valor($.env.get('OS'))) === 'Windows_NT') return { sistema: 'windows', como: 'OS=Windows_NT' }
  const wsl = await valor($.env.get('WSL_DISTRO_NAME'))
  if (wsl) return { sistema: 'wsl', como: `WSL_DISTRO_NAME=${wsl}` }
  const wayland = await valor($.env.get('WAYLAND_DISPLAY'))
  if (wayland) return { sistema: 'wayland', como: `WAYLAND_DISPLAY=${wayland}` }
  const x11 = await valor($.env.get('DISPLAY'))
  if (x11) return { sistema: 'x11', como: `DISPLAY=${x11}` }
  return { sistema: 'otro', como: 'sin OS=Windows_NT, WAYLAND_DISPLAY ni DISPLAY' }
}

/** Qué hacer cuando no se pudo copiar, según el sistema. */
export function consejo(sistema: Sistema): string {
  switch (sistema) {
    case 'windows':
      return 'PowerShell no pudo copiar (en equipos con PowerShell restringido solo queda el portapapeles de la terminal). Escribe /copiar-diagnostico.'
    case 'wsl':
      return 'no respondió powershell.exe de Windows ni wl-copy, xsel o xclip. Escribe /copiar-diagnostico.'
    case 'wayland':
      return 'instala wl-clipboard. Escribe /copiar-diagnostico para revisarlo.'
    case 'x11':
      return 'instala xsel (o xclip). Escribe /copiar-diagnostico para revisarlo.'
    default:
      return 'no encontré una herramienta de portapapeles. Escribe /copiar-diagnostico.'
  }
}

type Prueba = { ok: boolean; motivo: string; ms: number }

export async function probar($: EngineInterface, h: Herramienta, texto: string): Promise<Prueba> {
  const inicio = Date.now()
  const ms = () => Date.now() - inicio
  try {
    const r = await $.process.run(h.argv, { stdin: texto, env: h.env, timeoutMs: h.timeoutMs })
    if (r.exitCode === 0) return { ok: true, motivo: 'copió', ms: ms() }
    if (h.argv[0] === 'sh' && r.exitCode === 127) return { ok: false, motivo: 'no está instalado', ms: ms() }
    const detalle = r.stderr.trim().split('\n')[0]
    return { ok: false, motivo: `salió con código ${r.exitCode}${detalle ? `: ${detalle}` : ''}`, ms: ms() }
  } catch (err) {
    // Rechaza si no arranca (no está instalado) o si pasó su tiempo.
    if (ms() >= h.timeoutMs - 250) return { ok: false, motivo: `no respondió en ${h.timeoutMs / 1000} s`, ms: ms() }
    const detalle = (err instanceof Error ? err.message : String(err)).split('\n')[0]
    return { ok: false, motivo: `no está instalado${detalle ? ` (${detalle})` : ''}`, ms: ms() }
  }
}

/** Copia `texto`: primero con las herramientas del sistema y, si ninguna sirve, con $.ui.copy (OSC 52). */
export async function copiar($: EngineInterface, texto: string, superficie: RenderSurface): Promise<{ ok: boolean; sistema: Sistema }> {
  const { sistema } = await detectar($)
  // Muchas terminales (Ptyxis/VTE entre ellas) no dejan copiar por OSC 52: primero las del sistema.
  if (superficie === 'terminal') {
    for (const h of herramientas(sistema)) if ((await probar($, h, texto)).ok) return { ok: true, sistema }
  }
  try {
    return { ok: (await $.ui.copy({ text: texto, surface: superficie })).isCopied, sistema }
  } catch {
    return { ok: false, sistema }
  }
}

const NOMBRE: Record<Sistema, string> = {
  windows: 'Windows',
  wsl: 'Linux en WSL (copia al portapapeles de Windows)',
  wayland: 'Linux con Wayland',
  x11: 'Linux con X11',
  otro: 'sin escritorio gráfico detectado (¿macOS, SSH o una consola sin escritorio?)',
}

export const MUESTRA = 'Prueba de Copiar: ñandú, acción ✔'

/** Revisa en este equipo qué herramienta de portapapeles usa el botón y hace una copia de prueba. */
export async function diagnosticar($: EngineInterface): Promise<string> {
  const lineas: string[] = ['Diagnóstico de Copiar', '']
  const v = await $.session.version().catch(() => undefined)
  lineas.push(`Claude Code: ${v?.version ?? 'desconocida'} (necesita 2.1.303 o más reciente)`)
  const { sistema, como } = await detectar($)
  lineas.push(`Sistema: ${NOMBRE[sistema]} (${como})`)
  lineas.push('')
  lineas.push('Herramientas de portapapeles, en el orden en que las prueba el botón:')
  let usada: Herramienta | undefined
  for (const h of herramientas(sistema)) {
    if (usada) {
      lineas.push(`  · ${h.nombre}: no hace falta`)
      continue
    }
    const p = await probar($, h, MUESTRA)
    lineas.push(`${p.ok ? '✔' : '✘'} ${h.nombre}: ${p.ok ? `copió el texto de prueba (${p.ms} ms)` : p.motivo}`)
    if (p.ok) usada = h
  }
  lineas.push('')
  if (usada) {
    try {
      const r = await $.process.run(usada.leer, { env: usada.env, timeoutMs: usada.timeoutMs })
      const leido = r.stdout.replace(/\r?\n$/, '')
      if (r.exitCode === 0 && leido === MUESTRA) lineas.push(`✔ Prueba de copia: el portapapeles devolvió el mismo texto, con tildes («${MUESTRA}»).`)
      else if (r.exitCode === 0) lineas.push(`✘ Prueba de copia: el portapapeles devolvió otro texto («${leido.slice(0, 60)}»). Pega en un editor para revisarlo.`)
      else lineas.push(`· Prueba de copia: no pude leer el portapapeles de vuelta (${usada.leer[0]}); pega en un editor para revisarlo.`)
    } catch {
      lineas.push(`· Prueba de copia: no pude leer el portapapeles de vuelta (${usada.leer[0]}); pega en un editor para revisarlo.`)
    }
    lineas.push(`✔ El botón Copiar usa ${usada.nombre}. La prueba dejó «${MUESTRA}» en tu portapapeles.`)
  } else {
    lineas.push(`✘ Ninguna herramienta pudo copiar: ${consejo(sistema)}`)
    lineas.push('  Mientras tanto el botón usa el portapapeles de la terminal (OSC 52): funciona en Windows Terminal, WezTerm, kitty, Alacritty, foot, iTerm2 y tmux con set-clipboard; no en Ptyxis, GNOME Terminal ni otras basadas en VTE.')
  }
  if (sistema === 'windows' || sistema === 'wsl') {
    try {
      const r = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', '$ExecutionContext.SessionState.LanguageMode'], { timeoutMs: LENTO })
      const modo = r.stdout.trim()
      if (modo && modo !== 'FullLanguage') {
        lineas.push(`✘ PowerShell está en modo ${modo} (política del equipo): no deja copiar con PowerShell y solo queda el portapapeles de la terminal (OSC 52).`)
      } else if (modo) lineas.push(`✔ PowerShell en modo ${modo}.`)
    } catch {
      // sin powershell.exe ya lo dijo la lista de herramientas
    }
  }
  return lineas.join('\n')
}
