(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    return mod(require("../lib/infer"), require("../lib/tern"), require("acorn-walk/dist/walk.js"), require("acorn"), require("escodegen"), require);
  if (typeof define == "function" && define.amd) // AMD
    return define(["../lib/infer", "../lib/tern", "acorn-walk/dist/walk", "acorn", "escodegen"], mod);
  mod(tern, tern, acorn.walk, acorn);
})(function(infer, tern, walk, acorn) {
  "use strict";

  tern.defineQueryType("get_not_defined_identifiers", {
    takesFile: true,
    run: function (server, query, file) {
      return {
        notDefinedIdentifiers: Object.getOwnPropertyNames(file.scope.maybeProps)
      };
    }
  });

  tern.registerPlugin("not_defined_identifiers", function (options) {

  });
});
