const dbus = require('../');
const {
  isBusNameValid,
  isObjectPathValid,
  isInterfaceNameValid,
  isMemberNameValid
} = dbus.validators;

test('object path validators', () => {
  const validPaths = ['/', '/foo', '/foo/bar', '/foo/bar/bat'];
  for (const path of validPaths) {
    expect(isObjectPathValid(path)).toBe(true);
  }

  const invalidPaths = [undefined, {}, '', 'foo', 'foo/bar', '/foo/bar/', '/$/foo/bar', '/foo//bar', '/foo$bar/baz'];
  for (const path of invalidPaths) {
    expect(isObjectPathValid(path)).toBe(false);
  }
});

test('bus name validators', () => {
  const validNames = ['foo.bar', 'foo.bar.bat', '_foo._bar', 'foo.bar69', 'foo.bar-69', 'org.mpris.MediaPlayer2.google-play-desktop-player'];
  for (const name of validNames) {
    expect(isBusNameValid(name)).toBe(true);
  }

  const invalidNames = [undefined, {}, '', '5foo.bar', 'foo.6bar', '.foo.bar', 'bar..baz', '$foo.bar', 'foo$.ba$r'];
  for (const name of invalidNames) {
    expect(isBusNameValid(name)).toBe(false);
  }
});

test('interface name validators', () => {
  const validNames = ['foo.bar', 'foo.bar.bat', '_foo._bar', 'foo.bar69'];
  for (const name of validNames) {
    expect(isInterfaceNameValid(name)).toBe(true);
  }

  const invalidNames = [undefined, {}, '', '5foo.bar', 'foo.6bar', '.foo.bar', 'bar..baz', '$foo.bar', 'foo$.ba$r', 'org.mpris.MediaPlayer2.google-play-desktop-player'];
  for (const name of invalidNames) {
    expect(isInterfaceNameValid(name)).toBe(false);
  }
});

test('member name validators', () => {
  const validMembers = ['foo', 'FooBar', 'Bat_Baz69'];
  for (const member of validMembers) {
    expect(isMemberNameValid(member)).toBe(true);
  }

  const invalidMembers = [undefined, {}, '', 'foo.bar', '5foo', 'foo$bar'];
  for (const member of invalidMembers) {
    expect(isMemberNameValid(member)).toBe(false);
  }
});
