import {test, expect} from "@playwright/test";
import {ACCESS_ROUTES} from "../src/lib/access";
import {PERMISSION_KEYS} from "../src/lib/roles";
import {administration} from "./admin-fixture";

const grant="ab".repeat(32),session="cd".repeat(16),csrf="ef".repeat(32);
const revision="a".repeat(64),after="b".repeat(64);
const saved={network_max_connections:"128",network_idle_timeout:"120",logging_level:"info",general_language:"us"};
const review={schema:1,maintenance:true,read_only:true,restart_required:true,active_scope:"maintenance_process",
  hub_active_available:false,revision,matches_active:true,saved,active:saved,token:"upstream-secret"};
const access={maintenance:true,restart_required:true,expires_in:600,actor:{id:"1",role:"administrator",status:"active"},
  grant,session,csrf,permissions:PERMISSION_KEYS.map(key=>({key,granted:key!=="hub.manage",implemented:key!=="hub.manage"&&key!=="configuration.manage"})),
  routes:ACCESS_ROUTES.map(([method,path,permission])=>({method,path,permission,allowed:true}))};

test("maintenance editor validates, previews, confirms, writes and restores in English and Polish",async({page})=>{
  const calls:{path:string;body:string;grant:string;csrf:string}[]=[];
  await page.route("**/admin-api/v1/**",async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==="/admin-api/v1/admin/access")return route.fulfill({json:access});
    if(url.pathname==="/admin-api/v1/admin")return route.fulfill({json:administration});
    if(url.pathname.startsWith("/admin-api/v1/management/configuration")){
      calls.push({path:url.pathname,body:request.postData()??"",grant:request.headers()["x-dc24h-admin-grant"]??"",
        csrf:request.headers()["x-dc24h-csrf"]??""});
      if(request.method()==="GET")return route.fulfill({json:review});
      if(url.pathname.endsWith("/write")||url.pathname.endsWith("/restore"))return route.fulfill({json:{written:true,restart_required:true,revision:after,backup_available:true}});
      return route.fulfill({json:{valid:true,written:false,restart_required:true}});
    }
    return route.fallback();
  });
  await page.goto("/#configuration");
  await page.getByRole("button",{name:"Load / refresh saved configuration"}).click();
  await expect(page.getByTestId("configuration-editor-status")).toContainText("access is required");
  expect(calls).toHaveLength(0);
  await page.evaluate(()=>{location.hash="#adminCore";});
  await page.getByLabel("Active account ID").fill("1");
  await page.getByLabel("Account password").fill("Secret operator password!");
  await page.getByRole("button",{name:"Prove access",exact:true}).click();
  await expect(page.getByTestId("admin-access-result")).toContainText("Access proved");
  await page.evaluate(()=>{location.hash="#configuration";});
  await page.getByRole("button",{name:"Load / refresh saved configuration"}).click();
  await expect(page.getByTestId("config-input-network_max_connections")).toHaveValue("128");
  await page.getByTestId("config-input-network_max_connections").fill("0");
  await page.getByRole("button",{name:"Validate and preview changes"}).click();
  await expect(page.getByTestId("configuration-editor-status")).toContainText("valid settings");
  expect(calls).toHaveLength(1);
  await page.getByTestId("config-input-network_max_connections").fill("256");
  await page.getByTestId("config-input-general_language").selectOption("pl");
  await page.getByRole("button",{name:"Validate and preview changes"}).click();
  await expect(page.getByTestId("configuration-preview")).toContainText("256");
  expect(calls.at(-1)?.body).toBe("revision="+revision+"&network_max_connections=256&general_language=pl");
  await expect(page.getByRole("button",{name:"Save configuration"})).toBeDisabled();
  await page.getByText("I have reviewed the changes").click();
  await page.getByRole("button",{name:"Save configuration"}).click();
  await expect(page.getByTestId("configuration-editor-status")).toContainText("saved atomically");
  await expect(page.getByRole("alert")).toContainText("Restart required");
  expect(calls.at(-1)?.path).toBe("/admin-api/v1/management/configuration/write");
  await page.getByText("I understand that the saved configuration").click();
  await page.getByRole("button",{name:"Restore backup"}).click();
  await expect(page.getByTestId("configuration-editor-status")).toContainText("backup was restored");
  expect(calls.at(-1)?.path).toBe("/admin-api/v1/management/configuration/restore");
  expect(calls.at(-1)?.body).toBe("revision="+after);
  expect(calls.every(item=>item.grant===grant&&item.csrf===csrf)).toBe(true);
  expect((await page.evaluate(()=>document.body.innerText))).not.toContain("upstream-secret");
  expect((await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage})))).not.toContain(grant);
  await page.getByLabel("Interface language").selectOption("pl");
  await expect(page.getByRole("heading",{name:"Edytor konfiguracji serwisowej"})).toBeVisible();
});

test("lost write response shows unknown outcome and discards the old revision",async({page})=>{
  await page.route("**/admin-api/v1/**",async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==="/admin-api/v1/admin/access")return route.fulfill({json:access});
    if(url.pathname==="/admin-api/v1/admin")return route.fulfill({json:administration});
    if(url.pathname==="/admin-api/v1/management/configuration")
      return route.fulfill({json:request.method()==="GET"?review:{valid:true,written:false,restart_required:true}});
    if(url.pathname==="/admin-api/v1/management/configuration/write")return route.abort("connectionreset");
    return route.fallback();
  });
  await page.goto("/#adminCore");
  await page.getByLabel("Active account ID").fill("1");
  await page.getByLabel("Account password").fill("Secret operator password!");
  await page.getByRole("button",{name:"Prove access",exact:true}).click();
  await expect(page.getByTestId("admin-access-result")).toContainText("Access proved");
  await page.evaluate(()=>{location.hash="#configuration";});
  await page.getByRole("button",{name:"Load / refresh saved configuration"}).click();
  await page.getByTestId("config-input-network_max_connections").fill("256");
  await page.getByRole("button",{name:"Validate and preview changes"}).click();
  await expect(page.getByTestId("configuration-preview")).toBeVisible();
  await page.getByText("I have reviewed the changes").click();
  await page.getByRole("button",{name:"Save configuration"}).click();
  await expect(page.getByTestId("configuration-editor-status")).toContainText("result may be unknown");
  await expect(page.getByTestId("config-input-network_max_connections")).toHaveCount(0);
  await expect(page.getByTestId("configuration-preview")).toHaveCount(0);
});
