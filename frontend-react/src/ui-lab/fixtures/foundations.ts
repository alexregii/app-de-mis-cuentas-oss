export const foundationTokens = [
  {name: "Canvas", value: "--ui-canvas", description: "Base de trabajo: cifras y acciones antes que contenedores."},
  {name: "Surface", value: "--ui-surface", description: "Contención mínima de datos con radio de 8 px."},
  {name: "Overlay", value: "--ui-overlay", description: "Solo para capas flotantes; nunca decoración distribuida."},
  {name: "Money", value: "tabular-nums", description: "Signo, privacidad y cifras estables al escanear."},
] as const;

export const foundationRules = [
  {term: "Radios", detail: "Control 6 px · surface 8 px · overlay 12 px."},
  {term: "Separadores", detail: "Una línea fina organiza; no se acumulan bordes completos."},
  {term: "Iconos", detail: "Solo cuando aceleren reconocimiento o expresen un estado."},
  {term: "Movimiento", detail: "Corto y funcional; se elimina con reduced motion."},
] as const;
