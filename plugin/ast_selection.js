(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    return mod(require("../lib/infer"), require("../lib/tern"), require("acorn-walk/dist/walk.js"), require);
  if (typeof define == "function" && define.amd) // AMD
    return define(["../lib/infer", "../lib/tern", "acorn-walk/dist/walk"], mod);
  mod(tern, tern, acorn.walk);
})(function(infer, tern, walk, require) {
  "use strict";
  tern.defineQueryType("find_expectedType", {
    takesFile: true,
    run: function(server, query, file) {

      var end = tern.resolvePos(file, query.end);
      var text = file.text;
      var altEnd = end;
      // eat up previous whitespace
      while (altEnd > 0 && text.charAt(altEnd-1).match(/\s/)) altEnd--;

      var stack = [];

      var visitor = walk.make({});
      for (var i in visitor){
        (function(){
          var old = visitor[i];
          visitor[i] = function(n,s,c){
            if (n.start <= altEnd && n.end >= altEnd){
              if (n != s[s.length - 1]) s.push(n);
              old(n,s,c);
            }
          }
        })();
      }

      walk.recursive(file.ast, stack, visitor);

      // now find the first assignment or method call we are in
      if (stack.length > 0){
        for (var i = stack.length - 1; i >= 0; i--){
          switch (stack[i].type){
            case "CallExpression":
            case "NewExpression":
              var callExpression = stack[i];
              if (callExpression.callee.end >= end){
                if (callExpression.type === "NewExpression" && i > 0 && stack[i-1].type === "ExpressionStatement"){
                  // this is a simple "new Something" call which we cannot categorize - anything ("Object") is allowed!
                  return {type:"Object", start: Math.min(end, callExpression.start), end: end};
                }
                continue;
              }
              var callee = callExpression.callee;
              var scope = infer.scopeAt(file.ast, callee.end);
              if (scope){
                var type = infer.expressionType({node:callee, state:scope}).getFunctionType();
                if (type){
                  var callString = callExpression.sourceFile.text.substring(callExpression.start, callExpression.end);
                  var callStringOffset = callExpression.start;
                  // find non-whitespace, non "," element before the current end location..
                  var endOffset = end;
                  // eat up all whitespace and commata before the cursor
                  while (endOffset > callStringOffset && /[\s\,]/.test(callString.charAt(endOffset - callStringOffset -1))) endOffset--;
                  // count commata before insertion point:
                  var commaRegex = /,/;
                  var prefix = callString.substring(endOffset - callStringOffset, end - callStringOffset);
                  var posOffset = (prefix.match(/,/g)||[]).length;
                  // now find position at alternative location and then add the posOffset;
                  var pos = 0;
                  for (var k = 0; k < callExpression.arguments.length; k++){
                    var arg = callExpression.arguments[k];
                    if (arg.start <= endOffset && arg.end >= endOffset && !(arg.name === String.fromCharCode(10006))){
                      pos = k;
                      break;
                    }
                  }
                  pos += posOffset;
                  if (callExpression.arguments.length > 0 && callExpression.arguments[callExpression.arguments.length-1].end < end){
                    pos = callExpression.arguments.length;
                  }
                  if (type.args.length > pos){
                    var typeString = {};
                    if (type.args[pos] instanceof infer.Fn){
                      typeString = "function(";
                      for (var k = 0; k < type.args[pos].argNames.length; k++){
                        if (k > 0){
                          typeString += ",";
                        }
                        typeString += type.args[pos].argNames[k];
                      }
                      typeString += "){}";
                    } else if (type.args[pos].name){
                      typeString = type.args[pos].name;
                    } else if(type.args[pos].types) {
                      typeString = type.args[pos].types.map(function (type) {return type.name}).join("|");
                    }

                    if (callExpression.arguments && callExpression.arguments.length > pos){
                      var argument = callExpression.arguments[pos];
                      if (argument.name && argument.name.length == 1 && argument.name.charCodeAt(0) == 10006){
                        // unknown/empty argument
                        // length can be -1 in length in case of missing argument
                        return { type: typeString, start: argument.end - 1, end:argument.end - 1};
                      } else {
                        return { type: typeString, start: Math.min(argument.start, argument.end), end:Math.max(argument.end, argument.start)};
                      }
                    } else {
                      return { type: typeString, start: callExpression.end - 1, end: callExpression.end - 1};
                    }
                  }
                }
              }
              break;
            case "AssignmentExpression":
              var assignment = stack[i];
              if (assignment.left.end >= end){
                continue;
              }
              var left = assignment.left;
              var scope = infer.scopeAt(file.ast, assignment.end);
              if (scope){
                var type;
                if (left.type == "MemberExpression"){
                  // use the original type rather than the inferred one...
                  var ownerType = infer.expressionType({node:left.object, state:scope});
                  if (ownerType){
                    ownerType = ownerType.getType();
                    if (ownerType && ownerType.proto){
                      type = ownerType.proto.getProp(left.property.name);
                    }
                  }
                } else {
                  type = infer.expressionType({node:left, state:scope});
                }
                if (type){
                  type = type.getType();
                  if (type){
                    var match = type.name.match(/(.*)\.prototype$/); // strip prototype...
                    return {type:match ? match[1] : type.name, start: Math.min(end, assignment.right.start), end: end};
                  }
                }
              }
              break;
            case "Identifier":
              if (i > 0 && stack[i-1].type === "ExpressionStatement"){
                // this is a simple "Something" call which we cannot categorize - anything ("Object") is allowed!
                return {type:"Object", start: Math.min(end, stack[i].start), end: end};
              }
              // else look further....
              break;
            case "MemberExpression":
                // that's ok - iterate
              break;
            case "Property":
              // parameter objects
              if (!(i - 2 >= 0
                  && stack[i - 1].type === "ObjectExpression"
                  && (stack[i - 2].type === "CallExpression" || stack[i - 2].type === "NewExpression"))) {
                return {}
              }

              var property = stack[i];
              callee = stack[i - 2].callee;
              scope = infer.scopeAt(file.ast, callee.end);
              if (scope) {
                type = infer.expressionType({node: callee, state: scope}).getFunctionType();

                var argIndex = type.argNames.indexOf(property.key.name);
                if (argIndex < 0) {
                  // optional args
                  argIndex = type.argNames.indexOf(property.key.name + "?");
                }

                return {
                  type: type.args[argIndex].name,
                  start: tern.resolvePos(file, query.start),
                  end: end
                }
              }
              break;

            default:
                // not ok - just stop here.
              return {}
          }
        }
      }
      return {};
    }
  });

  tern.defineQueryType("findMatchingTypes", {
    takesFile: true,
    run: function(server, query, file) {

      var endPos = tern.resolvePos(file, query.end);
      var startPos = tern.resolvePos(file, query.start);
      var names = query.types;

      var scope = infer.scopeAt(file.ast, endPos);
      var result = [];
      if (scope) {
        var type;
        for (var propName in scope.props){
          var prop = scope.props[propName];
          if (prop && prop.getType){
            var type = prop.getType();
            if (type && type.name){
              var match = type.name.match(/(.*)\.prototype$/); // strip prototype...
              if (match ? names[match[1]] : names[type.name]) {
                result.push(propName);
              }
            }
          }
        }
      }
      return { properties: result};
    }
  });

  tern.defineQueryType("grow_astselection", {
    takesFile: true,
    run: function(server, query, file) {

      var endPos = tern.resolvePos(file, query.end);
      var startPos = tern.resolvePos(file, query.start);

      var stack = [];

      var visitor = walk.make({});
      for (var i in visitor){
        (function(){
          var old = visitor[i];
          visitor[i] = function(n,s,c){
            if (n.start <= startPos && n.end >= endPos){
              if (n.start == startPos && n.end == endPos) return;
              if (n !== s[s.length - 1] && n !== s[s.length - 2]) {
                s.push(n);
                if (n.type === "BlockStatement" && n.start < n.end - 1){
                  if (n.start +1 == startPos && n.end -1 == endPos) return;
                  if (n.start +1 <= startPos && n.end -1 >= endPos && n.sourceFile.text.charAt(n.start) === "{" && n.sourceFile.text.charAt(n.end -1) === "}"){
                    s.push({start: n.start +1, end: n.end -1})
                  }
                }
              }
              old(n,s,c);
            }
          }
        })();
      }

      walk.recursive(file.ast, stack, visitor);

      return {stack:stack.map(function(n){
        return {start: n.start, end: n.end};
      })};
    }
  });

  tern.defineQueryType("find_surrounding_expression", {
    takesFile: true,
    run: function (server, query, file) {
      var startPos = tern.resolvePos(file, query.start);
      var endPos = tern.resolvePos(file, query.end);

      var result;
      if (endPos > startPos) {
        result = walk.findNodeAt(file.ast, startPos, endPos);
      }
      if (!result || endPos === startPos) {
        result = walk.findNodeAround(file.ast, startPos);
      }

      if (result && (result.node.type.toLowerCase().indexOf("expression") >= 0 || result.node.type === "Literal")) {
        return {start: result.node.start, end: result.node.end};
      }
    }
  });

  tern.defineQueryType("find_object_completion_method", {
    takesFile: true,
    run: function(server, query, file) {
      var startPos = tern.resolvePos(file, query.start);

      var result = walk.findNodeAround(file.ast, startPos);

      if (!result) {
        return;
      }

      // find the end of the method name
      var pos = result.node.start - 1;
      while (pos >= 0 && !/[\w$]/.test(file.text.charAt(pos - 1))) pos--;

      var currentProperty = walk.findNodeAround(file.ast, tern.resolvePos(file, query.cursorPos));
      currentProperty = currentProperty && currentProperty.node.type === "Identifier" ? currentProperty.node.name : null;

      // extract all parameters already there
      var properties = result.node.properties.map(function (property) {
        return property.key.name
      }).filter(function (property) {
        return property !== currentProperty;
      });

      return {
        pos: pos,
        properties: properties
      };
    }
  });

});
