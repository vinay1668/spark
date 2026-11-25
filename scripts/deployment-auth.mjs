export function checkDeploymentAuth(env) {
  if (env.SPARK_TEST_AUTH === "true" || env.SPARK_DEV_API_KEY) {
    throw new Error("Remove test/dev authentication from production environment");
  }
  const secret = env.CLERK_SECRET_KEY || "";
  const publishable = env.CLERK_PUBLISHABLE_KEY || "";
  if (secret.startsWith("sk_live_") && publishable.startsWith("pk_live_")) return "production";
  if (env.SPARK_ALLOW_CLERK_DEVELOPMENT === "true" && secret.startsWith("sk_test_") && publishable.startsWith("pk_test_")) return "demo";
  throw new Error("Configure matching Clerk live keys, or explicitly set SPARK_ALLOW_CLERK_DEVELOPMENT=true for a demo with matching Clerk test keys");
}
