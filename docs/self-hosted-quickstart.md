# Instalación local con Docker

Esta guía levanta una instalación personal en el mismo equipo donde corre
Docker. La interfaz escucha solo en `localhost`; no la publiques en Internet ni
la abras a la red local con esta configuración.

## Requisitos

- Docker Desktop actualizado con Docker Compose v2 en Windows, macOS o Linux.
- Python para crear la clave local de Django. Python no ejecuta la aplicación;
  eso lo hacen los contenedores.
- Espacio local para la base de datos, los archivos importados y las copias de
  seguridad.

## Preparar la instalación

1. Descarga o clona el repositorio y abre una terminal en su carpeta raíz.
2. Crea `.env` desde el ejemplo con una clave aleatoria. El comando falla si
   `.env` ya existe, para conservar la configuración de una instalación
   anterior. No muestra la clave:

   ```powershell
   python scripts/init_self_hosted_env.py
   ```

   En macOS o Linux, ejecuta:

   ```sh
   python3 scripts/init_self_hosted_env.py
   ```

   El helper usa solo la biblioteca estándar de Python. No reutilices la clave
   de otra instalación ni compartas o subas `.env`.
3. Deja vacíos `ENABLE_BANKING_APP_ID` y
   `ENABLE_BANKING_PRIVATE_KEY_PATH`. La sincronización bancaria no forma parte
   de este inicio rápido.

## Iniciar

Desde PowerShell, ejecuta:

```powershell
docker compose -f compose.yml up --build -d web react-web backup
```

La primera construcción puede tardar unos minutos. Espera a que `web` aparezca
como `healthy` en `docker compose -f compose.yml ps`, y crea tu
usuario local:

```powershell
docker compose -f compose.yml exec web python manage.py createsuperuser
```

El comando solicita el nombre y la contraseña en la terminal. No hay una
cuenta ni una contraseña predeterminadas. Después abre <http://localhost:3001>
e inicia sesión. Django crea o actualiza la base de datos al iniciar el servicio
`web`.

Esta selección inicia la interfaz, la API y el programador de copias locales.
No inicia el servicio `maintenance`, que controla el socket de Docker; tampoco
inicia sincronización bancaria ni los trabajadores de modelos de lenguaje.

Para detener los servicios:

```powershell
docker compose -f compose.yml stop web react-web backup
```

Para volver a iniciarlos:

```powershell
docker compose -f compose.yml start web react-web backup
```

## Datos y copias de seguridad

La base de datos y los archivos de la aplicación se guardan en
`./self-hosted-data`; las copias automáticas se escriben en
`./self-hosted-backups`. Conserva ambas carpetas. Una
copia guardada en el mismo disco no protege frente a la pérdida o avería de ese
disco, así que copia periódicamente los archivos de `self-hosted-backups` a otro soporte
privado y seguro.

Consulta [Copia, restauración y actualización](self-hosted-recovery.md) para
restaurar una copia en una segunda instalación y recuperarte de una actualización
fallida.

No borres `self-hosted-data`, `self-hosted-backups` ni `.env` para actualizar la
app. Revisa las notas de la versión y sigue el procedimiento de copia y
recuperación antes de reconstruir los servicios.

## Acceso y sincronización bancaria

La configuración inicial escucha en `127.0.0.1`. El manifiesto mantiene
`DEBUG` desactivado, exige inicio de sesión y desactiva las cookies `Secure`
solo para el HTTP local en loopback. No lo uses como configuración de un
servicio HTTPS expuesto. No cambies los puertos a
`0.0.0.0` ni los reenvíes desde el router para hacer accesible la aplicación.
Un acceso remoto requiere una configuración HTTPS, autenticación y seguridad
revisadas para ese entorno; esta guía no configura ni valida esa exposición.

La conexión con bancos no está habilitada ni soportada por el Compose público.
La primera publicación se centra en movimientos manuales y CSV. Consulta la
[decisión sobre conexión bancaria](analysis/OSS_BANK_CONNECTION_DECISION_2026-11-19.md)
antes de considerar una configuración distinta: requiere una aplicación,
credenciales y cuentas propias, consentimiento de cada titular y un callback
público HTTPS. La licencia MIT del repositorio no concede acceso a servicios
bancarios ni derechos sobre sus API.

## Ayuda

Antes de reportar un problema, indica sistema operativo, versión de Docker y
los pasos que lo reproducen. No adjuntes `.env`, claves privadas, extractos ni
copias de la base de datos. Si necesitas compartir un ejemplo, usa datos
inventados.
