import * as v from 'valibot';

/**
 * A web address of a policy: with `http://` or `https://`, or without a scheme, which the
 * browser gives `https://`, as Chrome fixes up `example.com`. A scheme followed by a port
 * number, as in `intranet:8080`, counts as a host.
 */
const WebAddressInput = v.pipe(
  v.string(),
  v.maxLength(8192),
  v.regex(
    /^(https?:\/\/\S+|(?!\w[\w+.-]*:(?!\d))\S+)$/i,
    'Must be an http or https address, or one without a scheme',
  ),
);

/**
 * The values that policies take where the browser converts them before it checks them, such
 * as Chrome's formats: `{searchTerms}` in a search address and an address without a scheme.
 * The schemas of the settings convert such a value first and then check what they made, which
 * refuses what these refuse, so the browser carries only the conversion on its start path.
 * The policy reference and its JSON Schema describe these values instead of the schemas of
 * the settings; only the tools and the tests import this module, and a test keeps both in step.
 */
export const policyInputs: ReadonlyMap<string, v.GenericSchema> = new Map<string, v.GenericSchema>([
  [
    'DefaultSearchProviderSearchURL',
    v.pipe(
      v.string(),
      v.maxLength(2048),
      v.regex(
        /^https:\/\/\S+(%s|\{searchTerms\})\S*$/,
        'Must be an https URL with {searchTerms} or %s',
      ),
    ),
  ],
  ['HomepageLocation', v.union([v.literal(''), WebAddressInput])],
  ['RestoreOnStartupURLs', v.pipe(v.array(WebAddressInput), v.maxLength(100))],
]);
