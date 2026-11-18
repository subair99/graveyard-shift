/** Reverses the escaping of React's server renderer (& < > " '), in one pass. */
export function unescapeHtml(markup: string): string {
  return markup.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_m, name: string) => {
    switch (name) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      default:
        return "'";
    }
  });
}
