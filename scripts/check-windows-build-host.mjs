if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.error(
    `Windows installer must be built on Windows x64; current host is ${process.platform}-${process.arch}. ` +
      'Cross-building on macOS can package the wrong native agent runtime.'
  )
  process.exit(1)
}

console.log('Windows x64 build host verified.')
