// The app, for the tests of the pages behind AdminShell, with those pages already loaded. Otherwise the first test of a
// file to open one would load them (see AdminPage in shell.tsx), which can take longer than it waits for what they show.
import './admin-pages'

export { default } from '../../app'
