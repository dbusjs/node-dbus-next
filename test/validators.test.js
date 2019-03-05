let dbus = require('../');
const {
  isObjectPathValid,
  isInterfaceNameValid,
  isMemberNameValid
} = dbus.validators;

test('object path validators', () => {
  let validPaths = [ '/', '/foo', '/foo/bar', '/foo/bar/bat' ];
  for (path of validPaths) {
    expect(isObjectPathValid(path)).toBe(true);
  }

  let invalidPaths = [ undefined, {}, '', 'foo', 'foo/bar', '/foo/bar/', '/$/foo/bar', '/foo//bar', '/foo$bar/baz' ];
  for (path of invalidPaths) {
    expect(isObjectPathValid(path)).toBe(false);
  }
});

test('bus name validators', () => {
  let validNames = [ 'foo.bar', 'foo.bar.bat', '_foo._bar', 'foo.bar69' ];
  for (name of validNames) {
    expect(isInterfaceNameValid(name)).toBe(true);
  }

  let invalidNames = [ undefined, {}, '', '5foo.bar', 'foo.6bar', '.foo.bar', 'bar..baz', '$foo.bar', 'foo$.ba$r' ];
  for (name of invalidNames) {
    expect(isInterfaceNameValid(name)).toBe(false);
  }
});

test('member name validators', () => {
  let validMembers = [ 'foo', 'FooBar', 'Bat_Baz69' ];
  for (member of validMembers) {
    expect(isMemberNameValid(member)).toBe(true);
  }

  let invalidMembers = [ undefined, {}, '', 'foo.bar', '5foo', 'foo$bar' ];
  for (member of invalidMembers) {
    expect(isMemberNameValid(member)).toBe(false);
  }
});
