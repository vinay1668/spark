export function configureTestDatabase(env: NodeJS.ProcessEnv): void {
  if (env.SPARK_TEST_AUTH !== "true") return;
  if (env.NODE_ENV === "production") throw new Error("SPARK_TEST_AUTH cannot be enabled in production");
  const testUrl = env.SPARK_TEST_DATABASE_URL;
  if (!testUrl) throw new Error("Test authentication requires a dedicated SPARK_TEST_DATABASE_URL");
  const databaseIdentity = (value: string) => {
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}:${url.port || "5432"}${decodeURIComponent(url.pathname || "/")}`;
  };
  if (env.DATABASE_URL && databaseIdentity(testUrl) === databaseIdentity(env.DATABASE_URL)) {
    throw new Error("Test database must differ from DATABASE_URL");
  }
  env.DATABASE_URL = testUrl;
}
