import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDeploymentAuth } from "../scripts/deployment-auth.mjs";

const live = { CLERK_SECRET_KEY: "sk_live_fixture", CLERK_PUBLISHABLE_KEY: "pk_live_fixture" };
const demo = { CLERK_SECRET_KEY: "sk_test_fixture", CLERK_PUBLISHABLE_KEY: "pk_test_fixture" };

test("production uses live Clerk keys by default", () => {
  assert.equal(checkDeploymentAuth(live), "production");
  assert.throws(() => checkDeploymentAuth(demo));
  assert.throws(() => checkDeploymentAuth({}));
});

test("demo requires an explicit opt-in and matching test keys", () => {
  assert.equal(checkDeploymentAuth({ ...demo, SPARK_ALLOW_CLERK_DEVELOPMENT: "true" }), "demo");
  assert.throws(() => checkDeploymentAuth({ ...demo, SPARK_ALLOW_CLERK_DEVELOPMENT: "false" }));
  assert.throws(() => checkDeploymentAuth({ ...demo, CLERK_SECRET_KEY: live.CLERK_SECRET_KEY, SPARK_ALLOW_CLERK_DEVELOPMENT: "true" }));
  assert.throws(() => checkDeploymentAuth({ ...live, CLERK_SECRET_KEY: demo.CLERK_SECRET_KEY, SPARK_ALLOW_CLERK_DEVELOPMENT: "true" }));
});

test("demo opt-in never permits Spark authentication bypasses", () => {
  for (const keys of [live, demo]) {
    const env = { ...keys, SPARK_ALLOW_CLERK_DEVELOPMENT: "true" };
    assert.throws(() => checkDeploymentAuth({ ...env, SPARK_TEST_AUTH: "true" }));
    assert.throws(() => checkDeploymentAuth({ ...env, SPARK_DEV_API_KEY: "fixture" }));
  }
});
