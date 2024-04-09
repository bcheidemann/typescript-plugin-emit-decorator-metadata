import * as ts from 'typescript';
import type { TransformerExtras, PluginConfig } from 'ts-patch';

type LexicalScope = ts.SourceFile | ts.Block | ts.ModuleBlock | ts.CaseBlock;

function getFirstConstructorWithBody(node: ts.ClassLikeDeclaration): ts.ConstructorDeclaration & { body: ts.FunctionBody; } | undefined {
  return (ts as any).getFirstConstructorWithBody(node);
}

function createRuntimeTypeSerializer(context: ts.TransformationContext): RuntimeTypeSerializer {
  return (ts as any).createRuntimeTypeSerializer(context);
}
export interface RuntimeTypeSerializerContext {
  currentLexicalScope: LexicalScope;
  currentNameScope: ts.ClassLikeDeclaration | undefined;
}
export interface RuntimeTypeSerializer {
  serializeTypeNode(serializerContext: RuntimeTypeSerializerContext, node: ts.TypeNode): ts.Expression;
  serializeTypeOfNode(serializerContext: RuntimeTypeSerializerContext, node: ts.PropertyDeclaration | ts.ParameterDeclaration | ts.AccessorDeclaration | ts.ClassLikeDeclaration | ts.MethodDeclaration, container: ts.ClassLikeDeclaration): ts.Expression;
  serializeParameterTypesOfNode(serializerContext: RuntimeTypeSerializerContext, node: ts.Node, container: ts.ClassLikeDeclaration): ts.ArrayLiteralExpression;
  serializeReturnTypeOfNode(serializerContext: RuntimeTypeSerializerContext, node: ts.Node): any;
}
function createEmitHelperFactory(context: ts.TransformationContext): EmitHelperFactory {
  return (ts as any).createEmitHelperFactory(context);
}
export interface EmitHelperFactory {
  getUnscopedHelperName(name: string): ts.Identifier;
}

/** Changes string literal 'before' to 'after' */
export default function (
  _program: ts.Program,
  _pluginConfig: PluginConfig,
  { ts }: TransformerExtras,
) {
  return (context: ts.TransformationContext) => {
    const factory = context.factory;
    const typeSerializer = createRuntimeTypeSerializer(context);
    const emitHelperFactory = createEmitHelperFactory(context);

    function createESMetadataHelper(metadataKey: string, metadataValue: ts.Expression) {
      context.requestEmitHelper(esMetadataHelper);
      return factory.createCallExpression(
        emitHelperFactory.getUnscopedHelperName("__esMetadata"),
          /*typeArguments*/ undefined,
        [
          factory.createStringLiteral(metadataKey),
          metadataValue,
        ],
      );
    }

    function getTypeMetadata(node: ts.Declaration, container: ts.ClassLikeDeclaration, currentLexicalScope: RuntimeTypeSerializerContext['currentLexicalScope']) {
      let properties: ts.ObjectLiteralElementLike[] | undefined;
      if (shouldAddTypeMetadata(node)) {
        const typeProperty = factory.createPropertyAssignment("type", factory.createArrowFunction(/*modifiers*/ undefined, /*typeParameters*/ undefined, [], /*type*/ undefined, factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), typeSerializer.serializeTypeOfNode({ currentLexicalScope, currentNameScope: container }, node, container)));
        properties = append(properties, typeProperty);
      }
      if (shouldAddParamTypesMetadata(node)) {
        const paramTypeProperty = factory.createPropertyAssignment("paramTypes", factory.createArrowFunction(/*modifiers*/ undefined, /*typeParameters*/ undefined, [], /*type*/ undefined, factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), typeSerializer.serializeParameterTypesOfNode({ currentLexicalScope, currentNameScope: container }, node, container)));
        properties = append(properties, paramTypeProperty);
      }
      if (shouldAddReturnTypeMetadata(node)) {
        const returnTypeProperty = factory.createPropertyAssignment("returnType", factory.createArrowFunction(/*modifiers*/ undefined, /*typeParameters*/ undefined, [], /*type*/ undefined, factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), typeSerializer.serializeReturnTypeOfNode({ currentLexicalScope, currentNameScope: container }, node)));
        properties = append(properties, returnTypeProperty);
      }
      if (properties) {
        const typeInfoMetadata = createESMetadataHelper("design:typeinfo", factory.createObjectLiteralExpression(properties, /*multiLine*/ true));
        return factory.createDecorator(typeInfoMetadata);
      }
    }

    /**
     * Determines whether to emit the "design:type" metadata based on the node's kind.
     * The caller should have already tested whether the node has decorators and whether the
     * emitDecoratorMetadata compiler option is set.
     *
     * @param node The node to test.
     */
    function shouldAddTypeMetadata(node: ts.Declaration): node is ts.MethodDeclaration | ts.AccessorDeclaration | ts.PropertyDeclaration {
      const kind = node.kind;
      return kind === ts.SyntaxKind.MethodDeclaration
        || kind === ts.SyntaxKind.GetAccessor
        || kind === ts.SyntaxKind.SetAccessor
        || kind === ts.SyntaxKind.PropertyDeclaration;
    }

    /**
     * Determines whether to emit the "design:returntype" metadata based on the node's kind.
     * The caller should have already tested whether the node has decorators and whether the
     * emitDecoratorMetadata compiler option is set.
     *
     * @param node The node to test.
     */
    function shouldAddReturnTypeMetadata(node: ts.Declaration): node is ts.MethodDeclaration {
      return node.kind === ts.SyntaxKind.MethodDeclaration;
    }

    /**
     * Determines whether to emit the "design:paramtypes" metadata based on the node's kind.
     * The caller should have already tested whether the node has decorators and whether the
     * emitDecoratorMetadata compiler option is set.
     *
     * @param node The node to test.
     */
    function shouldAddParamTypesMetadata(node: ts.Declaration): node is ts.ClassLikeDeclaration & { _hasConstructorBrand: never; } | ts.MethodDeclaration | ts.AccessorDeclaration {
      switch (node.kind) {
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.ClassExpression:
          return getFirstConstructorWithBody(node as ts.ClassLikeDeclaration) !== undefined;
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.GetAccessor:
        case ts.SyntaxKind.SetAccessor:
          return true;
      }
      return false;
    }

    return (sourceFile: ts.SourceFile) => {
      function getLexicalScope(node: ts.Node, currentLexicalScope: LexicalScope) {
        switch (node.kind) {
          case ts.SyntaxKind.SourceFile:
          case ts.SyntaxKind.CaseBlock:
          case ts.SyntaxKind.ModuleBlock:
          case ts.SyntaxKind.Block:
            return node as ts.SourceFile | ts.CaseBlock | ts.ModuleBlock | ts.Block;
          default:
            return currentLexicalScope;
        }
      }

      function createVisitorWithLexicalScope<TIn extends ts.Node, TOut extends ts.Node>(
        currentLexicalScope: LexicalScope,
        visitor: (node: TIn, currentLexicalScope: LexicalScope) => ReturnType<ts.Visitor<TIn, TOut>>
      ): ts.Visitor<TIn, TOut> {
        return (node: TIn) => visitor(node, getLexicalScope(node.parent, currentLexicalScope));
      }

      function visitPropertyDeclaration(classLike: ts.ClassLikeDeclaration, node: ts.PropertyDeclaration, currentLexicalScope: LexicalScope) {
        const typeInfoMetadata = getTypeMetadata(node, classLike, currentLexicalScope);
        if (!typeInfoMetadata) {
          return ts.visitEachChild(
            node,
            createVisitorWithLexicalScope(currentLexicalScope, findClassDeclarationVisitor),
            context,
          );
        }
        let done = false;
        return ts.visitEachChild(node, (node) => {
          if (!done && (
            ts.isModifier(node) ||
            ts.isIdentifier(node)
          )) {
            done = true;
            // Insert metadata decorator before first modifier or identifier
            return [
              typeInfoMetadata,
              ts.visitNode(
                node,
                createVisitorWithLexicalScope(currentLexicalScope, findClassDeclarationVisitor),
              ),
            ];
          }
          return ts.visitNode(
            node,
            createVisitorWithLexicalScope(currentLexicalScope, findClassDeclarationVisitor),
          );
        }, context);
      }

      function findPropertyDeclaration(classLike: ts.ClassLikeDeclaration, node: ts.Node, currentLexicalScope: LexicalScope) {
        if (ts.isPropertyDeclaration(node)) {
          return visitPropertyDeclaration(classLike, node, currentLexicalScope);
        }

        return node;
      }

      function findClassDeclarationVisitor(node: ts.Node, currentLexicalScope: LexicalScope): ts.Node {
        if (ts.isClassLike(node)) {
          const classLike = node;
          return ts.visitEachChild(
            node,
            (node) => findPropertyDeclaration(classLike, node, currentLexicalScope),
            context,
          );
        }

        return ts.visitEachChild(
          node,
          createVisitorWithLexicalScope(currentLexicalScope, findClassDeclarationVisitor),
          context,
        );
      }

      function visitSourceFile(sourceFile: ts.SourceFile) {
        return ts.visitEachChild(
          sourceFile,
          (node) => findClassDeclarationVisitor(node, sourceFile),
          context,
        );
      }

      return visitSourceFile(sourceFile);
    };
  };
}

export const esMetadataHelper: ts.UnscopedEmitHelper = {
  name: "typescript:esMetadata",
  // importName: "__esMetadata",
  scoped: false,
  priority: 3,
  text: `
          var __esMetadata = (this && this.__esMetadata) || function (k, v) {
              return function (_, c) {
                  c.metadata[k] = v;
              }
          };`,
};

/**
 * Appends a value to an array, returning the array.
 *
 * @param to The array to which `value` is to be appended. If `to` is `undefined`, a new array
 * is created if `value` was appended.
 * @param value The value to append to the array. If `value` is `undefined`, nothing is
 * appended.
 *
 * @internal
 */
export function append<TArray extends any[] | undefined, TValue extends NonNullable<TArray>[number] | undefined>(to: TArray, value: TValue): [undefined, undefined] extends [TArray, TValue] ? TArray : NonNullable<TArray>[number][];
/** @internal */
export function append<T>(to: T[], value: T | undefined): T[];
/** @internal */
export function append<T>(to: T[] | undefined, value: T): T[];
/** @internal */
export function append<T>(to: T[] | undefined, value: T | undefined): T[] | undefined;
/** @internal */
export function append<T>(to: T[], value: T | undefined): void;
/** @internal */
export function append<T>(to: T[] | undefined, value: T | undefined): T[] | undefined {
  if (value === undefined) return to as T[];
  if (to === undefined) return [value];
  to.push(value);
  return to;
}
