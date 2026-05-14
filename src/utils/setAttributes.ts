export function setAttributes(element: Element, attributes: Record<string, string>) {
  for (const key of Object.keys(attributes)) {
    element.setAttribute(key, attributes[key]);
  }
}
