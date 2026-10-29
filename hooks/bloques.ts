// Parte una respuesta en markdown en trozos de texto y bloques de código
// cercados (``` o ~~~), que son lo que se dibuja con botón Copiar.

export type Trozo =
  | { tipo: 'texto'; texto: string }
  /** `abierto`: la valla de cierre todavía no llegó (la respuesta se está escribiendo). */
  | { tipo: 'codigo'; lenguaje: string; codigo: string; abierto: boolean }

const APERTURA = /^( *)(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/

const sinBordes = (s: string) => s.replace(/^\s*\n/, '').replace(/\n\s*$/, '')

export function partir(md: string): Trozo[] {
  const lineas = md.split('\n')
  const trozos: Trozo[] = []
  let texto: string[] = []
  const soltarTexto = () => {
    const t = sinBordes(texto.join('\n'))
    if (t.trim()) trozos.push({ tipo: 'texto', texto: t })
    texto = []
  }
  for (let i = 0; i < lineas.length; i++) {
    const m = APERTURA.exec(lineas[i]!)
    if (!m) {
      texto.push(lineas[i]!)
      continue
    }
    const sangria = m[1]!.length
    const valla = m[2]!
    const cierre = new RegExp(`^ *\\${valla[0]}{${valla.length},}[ \\t]*$`)
    let j = i + 1
    while (j < lineas.length && !cierre.test(lineas[j]!)) j++
    soltarTexto()
    // Dentro de una lista el bloque viene con sangría: se le quita, como al pegarlo.
    const codigo = lineas.slice(i + 1, j).map(l => l.slice(Math.min(sangria, l.length - l.trimStart().length)))
    trozos.push({ tipo: 'codigo', lenguaje: m[3] ?? '', codigo: codigo.join('\n'), abierto: j >= lineas.length })
    i = j
  }
  soltarTexto()
  return trozos
}
