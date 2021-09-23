function identifierToJs (identifier) {
  return identifier.charAt(0).toLowerCase() + identifier.slice(1);
}

function identifierFromJs (identifier) {
  return identifier.charAt(0).toUpperCase() + identifier.slice(1);
}

module.exports = {
  identifierToJs,
  identifierFromJs
};