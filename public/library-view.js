export const PAGE_SIZE = 30;
export const UNCLASSIFIED_TYPE = "__unclassified__";

export function semanticType(item) {
  return item.approved?.semanticType ?? item.draft?.decision?.semanticType ?? "";
}

export function reviewStatus(item) {
  if (item.approved && item.approvedChanged) return "changed";
  return item.approved ? "approved" : item.draft ? "draft" : "observed";
}

export function enginePresence(item) {
  return item.enginePresence ?? "unknown";
}

export function availableTypes(items) {
  const types = new Set(items.map(semanticType).filter(Boolean));
  return [...types].sort(compareText);
}

export function selectLibraryItems(items, {
  query = "",
  status = "",
  type = "",
  presence = "",
  sort = "name-asc"
}) {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    const path = item.componentRef?.prefabPath ?? "";
    const matchesQuery = `${item.name} ${item.sourceId} ${path}`.toLocaleLowerCase().includes(needle);
    const matchesType = !type || (type === UNCLASSIFIED_TYPE
      ? !semanticType(item)
      : semanticType(item) === type);
    return matchesQuery &&
      (!status || reviewStatus(item) === status) &&
      (!presence || enginePresence(item) === presence) &&
      matchesType;
  }).sort((left, right) => {
    const nameOrder = compareText(left.name, right.name) || compareText(left.sourceId, right.sourceId);
    if (sort === "name-desc") return -nameOrder;
    if (sort === "type-asc") {
      const leftType = semanticType(left);
      const rightType = semanticType(right);
      if (!leftType) return rightType ? 1 : nameOrder;
      if (!rightType) return -1;
      return compareText(leftType, rightType) || nameOrder;
    }
    return nameOrder;
  });
}

export function paginate(items, requestedPage, pageSize = PAGE_SIZE) {
  const totalPages = Math.ceil(items.length / pageSize);
  const page = Math.min(Math.max(1, requestedPage), Math.max(1, totalPages));
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    totalPages
  };
}

function compareText(left, right) {
  return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
}
