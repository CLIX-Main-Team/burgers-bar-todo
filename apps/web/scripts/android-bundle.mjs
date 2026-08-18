// Builds the signed Android App Bundle that Google Play accepts. Play has required .aab
// over .apk for new apps since 2021; the .apk we publish on the GitHub release link is for
// sideloading only and cannot be uploaded.
//
// This exists as a script rather than an npm one-liner because the Gradle wrapper is invoked
// differently per platform (gradlew.bat under cmd on Windows, ./gradlew under sh elsewhere),
// and the same command has to work on this machine, on the Mac, and on CI.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const androidDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'android')
const isWindows = process.platform === 'win32'

// Named relatively and run from the android directory: an absolute path would have to
// survive cmd.exe's word splitting, and this repository lives under "Claude Code". Windows
// needs the shell because Node refuses to spawn a .bat without one.
const result = spawnSync(isWindows ? '.\\gradlew.bat' : './gradlew', ['bundleRelease'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWindows,
})

if (result.status !== 0) process.exit(result.status ?? 1)

const bundle = join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab')
if (!existsSync(bundle)) {
  console.error(`Gradle reported success but no bundle at ${bundle}`)
  process.exit(1)
}
console.log(`\nSigned bundle ready for Play Console upload:\n  ${bundle}`)
