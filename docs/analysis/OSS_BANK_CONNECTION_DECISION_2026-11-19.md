# Decisión: conexión bancaria en el MVP autoalojado

**Fecha de revisión:** 2026-11-19
**Proveedor revisado:** Enable Banking
**Estado:** fuera de la primera publicación pública; integración opcional en el código, no habilitada ni soportada por el Compose público.

## Decisión

La primera publicación autoalojada se centra en entrada manual y CSV. El código de Enable Banking permanece en el repositorio MIT, pero la conexión no se presenta como función disponible de la instalación pública ni se habilita con valores predeterminados. No se proporcionan credenciales compartidas ni acceso bancario a través del proyecto.

Una persona que aloje su propia instancia podría evaluar la integración con su aplicación, clave privada y cuentas propias, bajo su responsabilidad y sujeto a las condiciones vigentes del proveedor. Esto no convierte al proyecto en un servicio de conexión bancaria ni autoriza acceso a cuentas de otras personas, uso profesional o comercial. No se promete compatibilidad bancaria ni soporte operativo.

## Evidencia de proveedor y aplicación

La página oficial de [términos de Enable Banking](https://enablebanking.com/terms/) indica que el sandbox está disponible para evaluación y desarrollo; producción se limita a cuentas vinculadas para evaluación o uso personal de individuos privados. Excluye el uso comercial, el acceso a cuentas ajenas y la puesta del servicio API a disposición de terceros. Cualquier uso fuera de esos términos requiere un acuerdo separado. Los términos también describen el consentimiento y la autenticación reforzada que la persona completa con su banco.

La [referencia de API](https://enablebanking.com/docs/api/reference/) requiere registrar la aplicación y sus URLs de redirección. Para registrar una app de producción pide descripción, contacto para privacidad, URL de privacidad y URL de términos; la activación puede depender de formalidades contractuales o de vincular cuentas propias. La [guía de inicio](https://enablebanking.com/docs/api/quick-start/) devuelve a la persona a la URL de callback registrada tras autorizar.

En el código actual, `banking_configured()` exige identificador de app, URL de callback y un archivo de clave privada existente. El Compose público no entrega esas variables ni monta una clave, por lo que la banca queda desactivada. La pantalla comunica que no está configurada; las rutas de conexión responden HTTP 400 y los comandos de sincronización se detienen sin procesar datos cuando faltan valores.

El inicio rápido escucha solo en `localhost`. Esa instalación no ofrece el callback HTTPS público necesario para completar la autorización bancaria. Habilitarla exige una instalación distinta con dominio público, HTTPS, callback registrado, secreto privado protegido y configuración revisada; editar `.env` por sí solo no cambia el Compose público ni resuelve el callback.

## Comportamiento y soporte

- Sin credenciales completas, no se muestra el flujo de conexión y la API rechaza el intento con un mensaje de configuración incompleta. CSV y gestión manual siguen disponibles.
- El consentimiento lo concede cada titular en el flujo de su entidad bancaria. Cada instalación debe usar su propia aplicación, credenciales y configuración; el repositorio no incluye claves ni una cuenta compartida.
- La instalación que habilite el proveedor es responsable de publicar aviso de privacidad y términos adecuados, proteger claves y datos, operar el callback HTTPS y atender solicitudes de privacidad y revocación.
- La conexión se sincroniza solo cuando la persona inicia el flujo previsto en la aplicación; esta decisión no añade sincronización automática en segundo plano.
- El motor de confirmación bancaria automática no forma parte de esta candidata: el tablero marca OSS-02 como completada, pero sus archivos no aparecen en este checkout. Los movimientos recibidos por la integración existente requieren revisión y confirmación manual en la app; no se importan automáticamente al ledger por reglas.
- No se validó una conexión real ni sandbox en este trabajo: no había credenciales autorizadas. Las pruebas de código con respuestas simuladas no equivalen a probar disponibilidad de bancos, consentimiento real o condiciones contractuales.

## Próximo criterio de revisión

Reconsiderar el alcance antes de anunciar compatibilidad bancaria a terceros, habilitarla en un despliegue de acceso remoto o convertirla en parte de un producto comercial. Antes de ese cambio se necesita confirmación escrita del proveedor para el caso de uso, revisión de privacidad y seguridad, y una prueba con sandbox o credenciales autorizadas. La licencia MIT del código no concede derechos sobre la API ni sustituye esas revisiones.

Esta lectura de páginas públicas describe el alcance del producto y no es una revisión jurídica del contrato aplicable a una instalación concreta.
