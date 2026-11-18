// `npm run start` does not serve the Crypt_Site (crypt-ui Requirement 1.7): print the notice and exit 1.
// Dependency-free: no import.

// Printed local preview address, no network use. Named exception ALLOWED_URL_LITERALS in tests/ui/unit/sourceScan.test.ts.
const devUrl = "http://localhost:3000/graveyard-shift/";

process.stderr.write(
  "`npm run start` does not serve the Crypt_Site. For development run `npm run dev` and open " +
    `${devUrl}. To preview a build, run \`npm run build\`, then serve the ` +
    "directory `out/` under the path `/graveyard-shift/` with any static file server.\n",
);
process.exitCode = 1;
