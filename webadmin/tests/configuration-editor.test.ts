import assert from "node:assert/strict";
import {test} from "node:test";
import {configurationChanges, configurationFailureNotice, configurationForm, parseConfigurationReview, parseConfigurationValidation,
  parseConfigurationWrite, validSetting} from "../src/lib/configuration-editor.ts";

const revision="a".repeat(64);
const saved={network_max_connections:"128",network_idle_timeout:"120",logging_level:"info",general_language:"us"};
const review={schema:1,maintenance:true,read_only:true,restart_required:true,active_scope:"maintenance_process",
  hub_active_available:false,revision,matches_active:true,saved,active:saved};

test("configuration editor accepts only four non-secret settings",()=>{
  assert.deepEqual(parseConfigurationReview({...review,token:"secret",saved:{...saved,password_file:"/secret"}}),review);
  const changes=configurationChanges(saved,{...saved,network_max_connections:"256",general_language:"pl"});
  assert.deepEqual(changes,{network_max_connections:"256",general_language:"pl"});
  assert.equal(configurationForm(revision,changes).toString(),"revision="+revision+"&network_max_connections=256&general_language=pl");
  assert.deepEqual(parseConfigurationValidation({valid:true,written:false,restart_required:true,secret:"none"}),
    {valid:true,written:false,restart_required:true});
  assert.deepEqual(parseConfigurationWrite({written:true,restart_required:true,revision,backup_available:true,secret:"none"}),
    {written:true,restart_required:true,revision,backup_available:true});
});

test("configuration editor fails closed on malformed payloads and invalid values",()=>{
  for(const patch of [{schema:2},{revision:"abc"},{maintenance:false},{hub_active_available:true},
    {active_scope:"hub"},{read_only:false},{matches_active:false},{saved:{...saved,network_idle_timeout:"0"}},
    {saved:{...saved,general_language:"de"}},{saved:{network_max_connections:"128"}}]) {
    assert.throws(()=>parseConfigurationReview({...review,...patch}));
  }
  for(const value of ["0","01","-1","65536","70000","1e3"," 100","100\nsecret=1","1&key=3"]) {
    assert.equal(validSetting("network_max_connections",value),false);
  }
  assert.equal(validSetting("network_idle_timeout","86400"),true);
  assert.equal(validSetting("network_idle_timeout","86401"),false);
  assert.throws(()=>configurationForm(revision,{}));
  assert.throws(()=>configurationForm(revision,{network_max_connections:"0"}));
  assert.throws(()=>configurationChanges(saved,{...saved,logging_level:"debug"}));
  assert.throws(()=>parseConfigurationValidation({valid:true,written:true,restart_required:true}));
  assert.throws(()=>parseConfigurationWrite({written:false,restart_required:true,revision,backup_available:true}));
  assert.throws(()=>parseConfigurationWrite({written:true,restart_required:true,revision,backup_available:false}));
});

test("a lost write/restore response is an unknown outcome, not a definite failure",()=>{
  for(const error of [new Error("Failed to fetch"),new Error("AbortError"),new SyntaxError("invalid JSON"),undefined]) {
    assert.equal(configurationFailureNotice(error,false),"configEditUnavailable");
    assert.equal(configurationFailureNotice(error,true),"configEditUnknown");
  }
  for(const key of ["configEditAuth","configEditStale","configEditRejected","configEditUnknown"]) {
    assert.equal(configurationFailureNotice(new Error(key),true),key);
  }
});
