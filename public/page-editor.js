export function flatten(root, parent = null, depth = 0) {
  return [{ node: root, parent, depth }, ...(root.kind === "container" ? root.children.flatMap(child => flatten(child, root, depth + 1)) : [])];
}
export function findNode(root, id) { return flatten(root).find(item => item.node.id === id); }
export function replaceNode(root, id, value) {
  if (root.id === id) return value;
  if (root.kind === "container") root.children = root.children.map(child => replaceNode(child, id, value));
  return root;
}
export function removeNode(root, id) {
  if (root.kind === "container") { root.children = root.children.filter(child => child.id !== id); root.children.forEach(child => removeNode(child, id)); }
}
export function reparentNode(root, id, parentId) {
  const current = findNode(root, id); const target = findNode(root, parentId);
  if (!current?.parent || target?.node.kind !== "container" || flatten(current.node).some(item => item.node.id === parentId)) throw new Error("父容器无效。");
  const absolute = nodeId => { const item = findNode(root, nodeId); const pos = item.parent ? absolute(item.parent.id) : { x: 0, y: 0 }; return { x: pos.x + item.node.rect.x, y: pos.y + item.node.rect.y }; };
  const position = absolute(id); const parentPosition = absolute(parentId);
  removeNode(root, id);
  current.node.rect.x = position.x - parentPosition.x; current.node.rect.y = position.y - parentPosition.y;
  target.node.children.push(current.node);
}
