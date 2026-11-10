# Instalar Copiar (guía para Claude)

Esta guía es para **Claude Code**: la persona te pidió instalar este mod en su equipo. Síguela en orden, en su idioma, y dile en una frase qué vas a hacer antes de cada paso que cambie algo. Funciona en **Windows 10/11** y **Linux**. En macOS usa `pbcopy`, pero nadie lo ha probado.

Al terminar, cada bloque de código de las respuestas de Claude sale en un recuadro con un botón **Copiar**, en **todas** las sesiones de Claude Code de la persona, en cualquier carpeta.

## 0. Antes de empezar

- Confirma con la persona que quiere instalarlo para todas sus sesiones (alcance `user`), porque cambia su configuración de Claude Code.
- Usa la herramienta de terminal que tengas: Bash o PowerShell. Abajo están los comandos de las dos.
- No la mandes a otra terminal: todos los comandos de esta guía los puedes ejecutar tú, salvo los que llevan `sudo` (pide permiso y, si no puedes darle la contraseña, que los escriba ella con `!` delante). Solo `/reload-plugins` lo tiene que escribir ella siempre.

## 1. Versión de Claude Code

```
claude --version
```

Se necesita **2.1.303 o más reciente**, porque los mods que dibujan en la terminal son recientes. Si es más vieja, `claude update` y pídele a la persona que reinicie Claude Code antes de seguir.

## 2. Descargar el mod a una carpeta propia

El mod se instala **desde una carpeta clonada**, no directo desde GitHub: así lo puedes adaptar después, y cada cambio llega con `/reload-plugins`. Usa una carpeta fuera de OneDrive, porque la sincronización puede bloquear los archivos.

PowerShell (Windows):

```powershell
$destino = "$env:USERPROFILE\claude-mods\claude-code-copiar"
if (Test-Path $destino) { git -C $destino pull } else { git clone https://github.com/waldooCreator/claude-code-copiar $destino }
```

Bash (Linux, o Git Bash en Windows):

```bash
destino="$HOME/claude-mods/claude-code-copiar"
[ -d "$destino" ] && git -C "$destino" pull || git clone https://github.com/waldooCreator/claude-code-copiar "$destino"
```

Si la persona ya tiene la carpeta del mod, porque la copió o descomprimió un `.zip`, no clones: muévela a esa misma ubicación, o usa la ruta donde está si no está dentro de OneDrive.

En el resto de la guía, `<carpeta>` es esa ruta completa.

## 3. Comprobar con qué copia este equipo

El botón copia con la herramienta de portapapeles del sistema: `wl-copy` en Wayland, `xsel` o `xclip` en X11, PowerShell en Windows y en WSL. Si no hay ninguna, usa el portapapeles de la terminal (OSC 52), que no funciona en todas.

Bash (Linux):

```bash
echo "sesión: ${XDG_SESSION_TYPE:-?}  WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-}  DISPLAY=${DISPLAY:-}  WSL=${WSL_DISTRO_NAME:-no}"
for h in wl-copy xsel xclip; do command -v "$h" >/dev/null && echo "✔ $h" || echo "✘ $h"; done
```

PowerShell (Windows):

```powershell
powershell.exe -NoProfile -Command '$ExecutionContext.SessionState.LanguageMode; Set-Clipboard -Value "Prueba de Copiar: ñandú"; Get-Clipboard'
```

Lo que hace falta según lo que salga:

| Síntoma | Qué hacer |
| --- | --- |
| Linux con `WAYLAND_DISPLAY` y `✘ wl-copy` | Falta `wl-clipboard`. Pregúntale a la persona si lo instalas; con su permiso, según la distribución: Fedora `sudo dnf install wl-clipboard`, Ubuntu/Debian/Mint `sudo apt install wl-clipboard`, Arch `sudo pacman -S wl-clipboard`, openSUSE `sudo zypper install wl-clipboard` (mira `/etc/os-release` si no sabes cuál es). |
| Linux solo con `DISPLAY` (X11) y `✘ xsel` y `✘ xclip` | Falta `xsel` (mejor que `xclip`). Con su permiso: `sudo dnf install xsel`, `sudo apt install xsel`, `sudo pacman -S xsel` o `sudo zypper install xsel`. |
| Linux sin `WAYLAND_DISPLAY` ni `DISPLAY` (SSH, consola) | No hay portapapeles del sistema: el botón usa OSC 52. Funciona si la terminal de la persona lo acepta (Windows Terminal, WezTerm, kitty, Alacritty, foot, iTerm2, tmux con `set-clipboard on`). No instales nada. |
| WSL | Copia con `powershell.exe` de Windows: no hace falta nada. |
| Windows: sale `FullLanguage` y luego `Prueba de Copiar: ñandú` | Todo listo, no hay que instalar nada. |
| Windows: sale `ConstrainedLanguage` o un error de «no se admite en este modo de lenguaje» | La empresa restringe PowerShell (AppLocker o WDAC). No intentes saltarte la política: el botón usará OSC 52, que funciona en Windows Terminal. Explícaselo a la persona. |
| Windows: la tilde sale dañada en `Get-Clipboard` | Es solo la consola mostrando el texto; el mod copia en UTF-8. El diagnóstico del paso 6 lo comprueba bien. |

Nunca instales nada sin que la persona lo apruebe. Si no quiere instalar nada, sigue igual: el mod funciona con OSC 52 donde la terminal lo permita.

## 4. Validar el mod

```
claude plugin validate "<carpeta>"
claude plugin test "<carpeta>"
```

Las dos deben terminar sin errores (`✔ Validation passed` y `0 fail`). El aviso de que `prompt.compose` no corre donde una organización administra Claude Code es informativo: ahí el botón funciona igual, solo que Claude no recibe la instrucción de poner lo copiable en bloques.

## 5. Instalarlo para todas las sesiones

```
claude plugin marketplace add "<carpeta>"
claude plugin install copiar@copiar --scope user
claude plugin list
```

En la lista debe aparecer `copiar@copiar` con `Scope: user`, `Status: enabled` y `Read from: <carpeta>`.

Si ya estaba instalado desde GitHub (sin carpeta), primero `claude plugin uninstall copiar@copiar` y `claude plugin marketplace remove copiar`, y luego repite este paso.

## 6. Activarlo y comprobarlo

1. Pídele a la persona que escriba `/reload-plugins` en esta sesión, o que abra una sesión nueva. Las sesiones nuevas lo cargan solas.
2. Después, llama tú a la herramienta `mcp__copiar__diagnostico`, o pídele que escriba `/copiar-diagnostico`. Debe salir `✔` en una herramienta y en «Prueba de copia». Avísale que la prueba deja un texto de prueba en su portapapeles.
3. Prueba final: respóndele con un bloque de código corto, por ejemplo:

   ```
   echo "hola desde Copiar"
   ```

   Pídele que pulse **Copiar** en el recuadro y lo pegue en cualquier sitio. Debe salir el aviso «Copiado: 1 línea» y pegarse exacto.

Cuéntale a la persona en 2 o 3 frases qué quedó: cada bloque de código trae un botón Copiar; Claude pondrá en bloques lo que sea para copiar; y `/copiar-diagnostico` revisa el portapapeles si algún día falla.

## 7. Si algo falla en este equipo

Corrige en `<carpeta>` (la lógica de copiar está en `hooks/portapapeles.ts`), valida con el paso 4 y pide `/reload-plugins`. Problemas conocidos:

- **«No pude copiar: instala …»:** falta la herramienta del paso 3. El aviso dice cuál según el sistema.
- **Copió pero el aviso tardó varios segundos (X11):** suele ser un `xclip` viejo; instala `xsel`, que el botón prueba primero.
- **Windows: la primera copia tarda unos segundos:** PowerShell 5.1 arranca lento en frío; el botón le da hasta 10 s. Las siguientes son más rápidas.
- **Windows: «PowerShell no pudo copiar»:** PowerShell restringido por la empresa o bloqueado. Queda OSC 52 en Windows Terminal; en la consola clásica (conhost) no hay respaldo, así que recomienda Windows Terminal.
- **Linux por SSH o en una terminal VTE (Ptyxis, GNOME Terminal) sin herramienta:** OSC 52 no llega; instala la herramienta del paso 3 en el equipo donde corre Claude Code.

## Actualizar o quitar

- Actualizar: `git -C "<carpeta>" pull` y luego `/reload-plugins`. Si adaptaste algo, revisa primero `git -C "<carpeta>" status` para no pisarlo.
- Quitar: `claude plugin uninstall copiar@copiar` y `claude plugin marketplace remove copiar`. La carpeta se puede borrar después.
