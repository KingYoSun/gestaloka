// Fixed TLS paths published at https://emudhra.we-have-a-problem.com/ (#91).
const targets = [
  { url: "https://emudhra.we-have-a-problem.com/", status: 200 },
  { url: "https://api.openai.com/v1/models", status: 401 },
];
for (const type of ["dv", "ov", "ev"])
  for (const root of ["g3b", "g3c"])
    for (const cross of ["", "-aaa"])
      targets.push({
        url: `https://${type}-${root}${cross}-emudhra.we-have-a-problem.com/`,
      });

const results = await Promise.all(
  targets.map(async ({ url, status }) => {
    try {
      // No credentials: a TLS rejection must never trigger an authenticated retry.
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      await response.body?.cancel();
      return {
        url,
        status: response.status,
        passed: response.status === status,
      };
    } catch (error) {
      const code = error.cause?.code ?? error.code ?? error.name;
      return {
        url,
        code,
        passed: status === undefined && code === "CERT_REVOKED",
      };
    }
  }),
);
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      node: process.version,
      openssl: process.versions.openssl,
      results,
    },
    null,
    2,
  ),
);
if (results.some(({ passed }) => !passed)) process.exitCode = 1;
