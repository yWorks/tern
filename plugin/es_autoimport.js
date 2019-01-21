(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    return mod(require("../lib/infer"), require("../lib/tern"), require("acorn-walk/dist/walk.js"), require("acorn"), require("escodegen"), require);
  if (typeof define == "function" && define.amd) // AMD
    return define(["../lib/infer", "../lib/tern", "acorn-walk/dist/walk", "acorn", "escodegen"], mod);
  mod(tern, tern, acorn.walk, acorn);
})(function(infer, tern, walk, acorn) {
  "use strict";

  tern.defineQueryType("add_es_import", {
    takesFile: true,
    run: function (server, query, file) {
      var existingImport = null;

      walk.simple(file.ast, {
        ImportDeclaration: function (node) {
          if (node.source.value === query.module) {
            existingImport = node;
          }
        }
      });

      if (existingImport !== null) {
        if (existingImport.specifiers.some(function (specifier) { return specifier.imported.name === query.name; })) {
          return;
        }

        var id = {
          "type": "Identifier",
          "name": query.name
        };
        existingImport.specifiers.push({
          "type": "ImportSpecifier",
          "imported": id,
          "local": id
        });

        existingImport.specifiers.sort(function (a, b) {
          return a.imported.name.localeCompare(b.imported.name);
        });

        return {
          start: existingImport.start,
          end: existingImport.end,
          text: escodegen.generate(existingImport)
        };
      } else {
        var importDecl = acorn.parse("import {" + query.name + '} from "' + query.module + '"', {
          sourceType: "module"
        }).body[0];

        return {
          start: 0,
          end: 0,
          text: escodegen.generate(importDecl) + "\n\n"
        };
      }
    }
  });

  tern.registerPlugin("es_autoimport", function (options) {

  });
});
