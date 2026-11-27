export default {
  async scheduled(_controller, env) {
    const at = new Date().toISOString();
    const signal = AbortSignal.timeout(10_000);
    let status = null;
    let cfRay = null;
    let failure = null;

    try {
      const response = await fetch(env.HEALTH_URL, {
        cache: "no-store",
        cf: { cacheTtlByStatus: { "100-599": -1 } },
        redirect: "manual",
        signal,
      });
      status = response.status;
      cfRay = response.headers.get("cf-ray");
      if (status === 200) {
        const health = await response.json();
        if (health?.service !== "gestaloka" || health.status !== "ok") {
          failure = "invalid_health";
        }
      } else {
        failure = "http_status";
        await response.body?.cancel();
      }
    } catch (error) {
      if (signal.aborted) failure = "timeout";
      else if (error instanceof SyntaxError) failure = "invalid_health";
      else failure ??= "fetch_error";
    }

    console.log({
      event: "api_probe",
      at,
      ok: failure === null,
      status,
      cfRay,
      failure,
    });
  },
};
