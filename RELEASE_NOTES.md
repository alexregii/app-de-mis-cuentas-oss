# v0.1.0 — primera versión autoalojada

Esta candidata se centra en sustituir el registro manual en hojas de cálculo
por una aplicación personal que importa CSV, permite revisar movimientos y
exporta a Excel.

## Incluye

- Instalación local de una persona con Docker Compose, enlazada a `localhost`.
- Cuentas manuales e importación CSV con detección de posibles duplicados.
- Revisión explícita antes de incorporar filas importadas al ledger.
- Estadísticas y exportación de movimientos a Excel.
- Copias automáticas locales y copia manual exportable con procedimiento de
  recuperación documentado.
- Ejemplos CSV y capturas con datos ficticios.

## Límites

- Una persona y una instalación; no incluye registro de usuarios, sincronización
  entre dispositivos ni servicio alojado.
- SQLite en el layout documentado. No se promete soporte de PostgreSQL ni de
  múltiples escritores simultáneos.
- El Compose público escucha solo en loopback. No es una configuración para
  publicar en Internet.
- La conexión bancaria está desactivada y fuera del soporte de esta versión.
  No se proporcionan credenciales ni derechos de acceso a APIs bancarias.
- No se distribuyen imágenes OCI; Compose construye las imágenes en el equipo
  donde se instala la aplicación.
- Primera versión de la serie 0.x; futuras versiones pueden incluir cambios
  incompatibles mientras evoluciona el formato de datos.

## Estado de validación del candidato

El candidato se construyó y arrancó desde un clon limpio en Windows 11 con
Docker Desktop y WSL 2. Se verificaron el login, el bloqueo anónimo de la API,
la importación CSV con revisión de duplicados, la descarga Excel, la
persistencia tras reiniciar los contenedores y una restauración manual en una
segunda instalación. Esta validación cubre una máquina Windows con Docker
Desktop; no acredita pruebas separadas en macOS o Linux ni soporte para acceso
remoto o alojamiento gestionado.

## v0.1.1 — actualización de la política de seguridad

La guía `SECURITY.md` ahora dirige directamente al canal privado de
vulnerabilidades, que está habilitado en el repositorio público. Esta versión
solo actualiza documentación; no cambia el código de la aplicación.

## v0.1.2 — guía visual e instalación para agentes

El README ahora presenta el flujo CSV→revisión→Excel y una captura móvil con
datos sintéticos. La distribución incluye una guía común para agentes de código
y entradas ligeras para Claude Code, Gemini CLI y GitHub Copilot. El nuevo
helper crea `.env` con una clave aleatoria sin mostrarla ni sobrescribir una
configuración existente. No cambia el comportamiento financiero de la app.

## v0.1.3 — captura móvil de viewport

El README reemplaza la captura móvil de página completa por una captura
390×1000 del viewport, legible al abrir el repositorio. Usa una cuenta y un
saldo ficticios; el código de la aplicación no cambia.
