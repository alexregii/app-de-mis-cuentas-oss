# Instrucciones para agentes

## Proyecto

APP de mis cuentas es una aplicación personal y autoalojada para importar
movimientos CSV, revisarlos, consultar estadísticas y exportarlos a Excel. Cada
instalación es para una persona. Los datos viven en SQLite y en el directorio
local del usuario.

No habilites conexión bancaria, registro multiusuario, alojamiento gestionado
ni acceso desde Internet. El Compose público solo publica en loopback y no
incluye el servicio con acceso al socket Docker.

## Instalación local

Cuando te pidan arrancar la aplicación, sigue `docs/self-hosted-quickstart.md`.
Si no existe `.env`, ejecuta `python scripts/init_self_hosted_env.py` en Windows
o `python3 scripts/init_self_hosted_env.py` en macOS/Linux. El helper genera una
clave aleatoria sin mostrarla y se niega a reemplazar una configuración
existente. Después arranca solo `web`, `react-web` y `backup` con Docker Compose,
espera a que `web` esté healthy y crea el primer usuario con
`createsuperuser`. No hay credenciales predeterminadas.

Los puertos deben permanecer en `127.0.0.1`. No los cambies a `0.0.0.0`, no
reenvíes puertos del router y no uses datos financieros reales ni credenciales
bancarias para desarrollar o validar cambios.

## Cambios y comprobaciones

- Lee `docs/self-hosted-recovery.md` antes de cambiar o restaurar datos.
- Conserva el alcance de una instalación personal local y las copias de
  `self-hosted-data` y `self-hosted-backups`.
- No añadas dependencias para un cambio que resuelva la biblioteca estándar o
  las herramientas ya presentes.
- Usa Python 3.13 y Node 20.19.5 para desarrollo. Comprueba el contrato de
  dependencias con `python scripts/bootstrap.py --check-only`; ejecuta
  `python manage.py test`, `npm test` y `npm run build` cuando cambien sus áreas.
- Nunca incluyas `.env`, claves, bases de datos locales, copias de seguridad o
  adjuntos en commits.
- No publiques releases, cambies la visibilidad del repositorio ni difundas
  anuncios salvo que la tarea lo pida explícitamente.
