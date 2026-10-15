/**
 * Host half of `dsh-enter-chime`.
 *
 * Every behaviour lives in the browser half (`exports["./client"]`): the
 * approval Enter binding is a DOM concern and the completion chime reads the
 * Client session-status projection. The Host half exists so the profile bundle
 * has a row to mount, and so the client-modules scan can find this package's
 * `dsh.client` declaration.
 */

/** Node plugin body: this package contributes nothing on the Host side. */
function apply() {}

export { apply };
