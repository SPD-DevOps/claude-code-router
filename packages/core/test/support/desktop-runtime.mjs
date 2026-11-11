// Tests running under Node must model both conditions checked by isDesktopAppRuntime.
// Never change the production Electron guard merely to satisfy desktop-only fixtures.
export function simulateElectronVersion() {
  const previous = Object.getOwnPropertyDescriptor(process.versions, "electron");
  if (!previous) Object.defineProperty(process.versions, "electron", { value: "test-electron", configurable: true });
  return () => {
    if (previous) Object.defineProperty(process.versions, "electron", previous);
    else delete process.versions.electron;
  };
}
