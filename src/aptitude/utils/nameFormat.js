function capitalizeNamePart(part) {
  return part
    .toLowerCase()
    .replace(/(^|[-'`])([a-z])/g, (_, separator, letter) => `${separator}${letter.toUpperCase()}`);
}

export function formatDisplayName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(capitalizeNamePart)
    .join(' ');
}
