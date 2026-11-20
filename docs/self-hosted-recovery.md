# Copia, restauración y actualización

Esta guía cubre el Compose público de autoalojado. Usa SQLite en
`self-hosted-data` y guarda los archivos subidos en
`self-hosted-data/media`. El perfil público no monta el socket Docker ni
arranca el coordinador automático de restauración. La copia se puede crear
desde la app; para restaurarla se requiere acceso local al host y detener los
servicios mientras se sustituyen los archivos.

## Crear y guardar una copia

Desde la raíz del proyecto, crea una copia manual:

```powershell
docker compose -f compose.yml exec web python manage.py backup_finance --destination /app/backups --kind manual
```

El ZIP aparece en `self-hosted-backups/manual/`. Incluye `manifest.json`,
`db.sqlite3` y los archivos de `media/`. No incluye `.env`,
`DJANGO_SECRET_KEY` ni credenciales de servicios externos. Copia el ZIP a otro
dispositivo; una copia guardada en el mismo disco no protege frente a su pérdida.

## Restaurar en una segunda instalación

Usa una carpeta de proyecto separada y una instalación nueva. Si ambas
instalaciones están en el mismo equipo, detén la primera porque las dos usan los
puertos locales `8000` y `3001`. Prepara `.env` siguiendo la guía rápida y
genera una `DJANGO_SECRET_KEY` nueva. La base restaurada contiene las cuentas y
contraseñas de la instalación de origen; no crees otro superusuario antes de
restaurar.

Copia el ZIP a `self-hosted-backups/manual/` de la segunda instalación. En
PowerShell, extrae el archivo y coloca la base de datos y los adjuntos en el
directorio que monta Compose:

```powershell
$archive = Get-ChildItem .\self-hosted-backups\manual\*.zip | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$stage = Join-Path $env:TEMP ("mis-cuentas-restore-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stage, .\self-hosted-data, .\self-hosted-backups | Out-Null
Expand-Archive -LiteralPath $archive.FullName -DestinationPath $stage
Copy-Item -LiteralPath (Join-Path $stage "db.sqlite3") -Destination .\self-hosted-data\db.sqlite3 -Force
$sourceMedia = Join-Path $stage "media"
$targetMedia = Join-Path .\self-hosted-data "media"
New-Item -ItemType Directory -Path $targetMedia -Force | Out-Null
if (Test-Path -LiteralPath $sourceMedia) {
    Get-ChildItem -LiteralPath $sourceMedia -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $targetMedia -Recurse -Force
    }
}
```

En Linux, crea `self-hosted-data/media` y `self-hosted-backups`, extrae el ZIP
en una carpeta temporal y copia `db.sqlite3` a `self-hosted-data/`. Si el ZIP
incluye `media/`, copia su contenido a `self-hosted-data/media/`; las copias
sin adjuntos no contienen esa carpeta y se restauran con `media/` vacío. Conserva
aparte la copia anterior si restauras sobre una instalación que ya contiene
datos; para la prueba en una segunda instalación, usa un directorio de datos
vacío.

Arranca la segunda instalación con un nombre de proyecto distinto:

```powershell
docker compose -p mis-cuentas-restaurada -f compose.yml up --build -d web react-web backup
docker compose -p mis-cuentas-restaurada -f compose.yml ps
docker compose -p mis-cuentas-restaurada -f compose.yml exec web python manage.py verify_restore_database
```

Al iniciar, `web` aplica las migraciones pendientes y `seed_defaults` conserva
los valores iniciales sin sobrescribir los datos restaurados. Comprueba el
inicio de sesión de origen, los recuentos e importes de Movimientos y que los
adjuntos abran. La restauración manual no usa el socket Docker: requiere que
los servicios estén detenidos mientras se copian los archivos.

## Actualizar y recuperarse de un fallo

Antes de actualizar, crea una copia manual y guarda otra copia del ZIP fuera de
los directorios de la app. Construye primero los servicios y luego actualízalos:

```powershell
docker compose -f compose.yml build web react-web backup
docker compose -f compose.yml up -d web react-web backup
docker compose -f compose.yml ps
docker compose -f compose.yml logs --tail 100 web
docker compose -f compose.yml exec web python manage.py verify_restore_database
```

Después inicia sesión y comprueba movimientos, estadísticas, un adjunto y la
descarga de Excel. Si falla la construcción, los contenedores actuales siguen
ejecutándose. Si la versión nueva falla al arrancar o tras una migración,
detén todos los servicios, conserva el directorio de datos fallido y restaura
`db.sqlite3` y `media/` desde la copia previa. Vuelve al código de la versión
anterior y arranca ese código solo después de restaurar una base compatible;
no ejecutes una versión antigua sobre un esquema migrado que no admita la
bajada.

## Compatibilidad y límites

- El archivo es `mis-cuentas-backup` versión 1: contiene SQLite y archivos de
  `media/`, no `.env`, claves ni la configuración del host.
- La recuperación solo admite SQLite y el layout actual del contenedor:
  `/app/data/db.sqlite3` y `/app/data/media`. No cubre PostgreSQL, rutas
  personalizadas ni varios writers durante la copia.
- Las migraciones compatibles se aplican al arrancar. No se promete una bajada
  automática de esquema; usa la copia previa antes de volver a una versión que
  no soporte el esquema actual.
- El Compose público desactiva la restauración automática para no ofrecer una
  solicitud que requiera un worker privilegiado ausente. La pantalla de
  recuperación avisa y apunta a este procedimiento manual.
- Las copias manuales no se eliminan automáticamente. Revisa el espacio local y
  conserva la última copia válida fuera del equipo.

## Verificación con datos sintéticos

Se creó una copia manual desde un SQLite en la migración `0022`, se restauró en
un segundo directorio y se aplicó la migración `0023` del código actual. La
verificación de esquema pasó y se conservaron una cuenta, dos movimientos,
`1.000,00` de ingresos, `25,50` de gastos y un adjunto PDF, cuyo SHA-256 se
comparó antes y después. La base se comprobó con `verify_restore_database`.
Este ensayo valida la copia, la sustitución de archivos y la migración de la
base desechable; no ejecuta `docker compose up` porque el motor Docker de este
equipo no está operativo.
