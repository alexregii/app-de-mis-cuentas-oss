const monthTitleFormatter = new Intl.DateTimeFormat("es-ES", {month: "long", year: "numeric"});

export const formatMonthTitle = (date: Date) =>
  monthTitleFormatter.format(date).replace(/^./, (letter) => letter.toUpperCase());
