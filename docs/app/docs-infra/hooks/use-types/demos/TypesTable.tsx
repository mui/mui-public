import * as React from 'react';
import type { AnyType } from 'typescript-api-extractor';
import { Types, useTypes } from '@mui/internal-docs-infra/useTypes';
import {
  TypesMeta,
  ComponentTypeMeta,
  HookTypeMeta,
} from '@mui/internal-docs-infra/pipeline/loadPrecomputedTypesMeta';
import styles from './TypesTable.module.css';

export type TypesTableProps = Types & {};

export function TypeDoc(props: {
  type: AnyType;
  depth?: number;
  showName?: boolean;
  isOptionalProperty?: boolean;
}) {
  const { type, depth = 0, showName = true, isOptionalProperty = false } = props;
  const maxDepth = 10; // Prevent infinite recursion

  if (depth > maxDepth) {
    return <div className={styles.typeDoc}>...</div>;
  }

  const renderType = (t: AnyType): React.ReactNode => {
    switch (t.kind) {
      case 'intrinsic':
        return t.intrinsic === 'undefined' ? (
          <span className={styles.undefinedType}>{t.intrinsic}</span>
        ) : (
          <span className={styles.intrinsicType}>{t.intrinsic}</span>
        );

      case 'literal':
        return <span className={styles.literalType}>{JSON.stringify(t.value)}</span>;

      case 'array':
        return (
          <div className={styles.arrayType}>
            <TypeDoc type={t.elementType} depth={depth + 1} />
            []
          </div>
        );

      case 'union': {
        // Filter out 'undefined' from union types when we're in an optional property context
        const filteredTypes = isOptionalProperty
          ? t.types.filter(
              (memberType) =>
                !(memberType.kind === 'intrinsic' && memberType.intrinsic === 'undefined'),
            )
          : t.types;

        // If filtering left us with only one type, render it directly without union wrapper
        if (filteredTypes.length === 1) {
          const firstType = filteredTypes[0];
          const typeName = 'typeName' in firstType ? firstType.typeName?.name : undefined;
          return (
            <React.Fragment>
              {firstType.kind === 'object' && typeName && (
                <div className={styles.typeName}>{typeName}</div>
              )}
              {renderType(firstType)}
            </React.Fragment>
          );
        }

        return (
          <div className={styles.unionType}>
            {filteredTypes.map((memberType, index) => (
              <React.Fragment key={index}>
                {index > 0 && <span className={styles.unionSeparator}> | </span>}
                <TypeDoc type={memberType} depth={depth + 1} />
              </React.Fragment>
            ))}
          </div>
        );
      }

      case 'intersection':
        return (
          <div className={styles.intersectionType}>
            {t.types.map((memberType, index) => (
              <React.Fragment key={index}>
                {index > 0 && <span className={styles.intersectionSeparator}> & </span>}
                <TypeDoc type={memberType} depth={depth + 1} />
              </React.Fragment>
            ))}
          </div>
        );

      case 'object':
        if (t.properties.length === 0) {
          return null;
        }
        return (
          <div className={styles.objectType}>
            <div className={styles.objectBrace}>{'{'}</div>
            <div className={styles.objectProperties}>
              {t.properties.map((prop) => (
                <div key={prop.name} className={styles.property}>
                  <div className={styles.propertyBody}>
                    <span className={styles.propertyName}>
                      {prop.name}
                      {prop.optional ? '?' : ''}:
                    </span>
                    <span className={styles.propertyType}>
                      <TypeDoc
                        type={prop.type}
                        depth={depth + 1}
                        isOptionalProperty={prop.optional}
                      />
                    </span>
                  </div>
                  {prop.documentation?.description && (
                    <div className={styles.propertyDoc}>{prop.documentation.description}</div>
                  )}
                </div>
              ))}
            </div>
            <div className={styles.objectBrace}>{'}'}</div>
          </div>
        );

      case 'component':
        return (
          <div className={styles.componentType}>
            <div className={styles.componentName}>React Component</div>
            {t.props.length > 0 && (
              <div className={styles.componentProps}>
                {t.props.map((prop) => (
                  <div key={prop.name} className={styles.property}>
                    <div className={styles.propertyBody}>
                      <span className={styles.propertyName}>
                        {prop.name}
                        {prop.optional ? '?' : ''}:
                      </span>
                      <span className={styles.propertyType}>
                        <TypeDoc
                          type={prop.type}
                          depth={depth + 1}
                          isOptionalProperty={prop.optional}
                        />
                      </span>
                    </div>
                    {prop.documentation?.description && (
                      <div className={styles.propertyDoc}>{prop.documentation.description}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'function':
        return (
          <div className={styles.functionType}>
            {t.callSignatures.map((signature, index) => (
              <div key={index} className={styles.callSignature}>
                <span className={styles.functionParams}>
                  (
                  {signature.parameters.map((param, paramIndex) => (
                    <span key={param.name} className={styles.functionParam}>
                      <span className={styles.paramName}>
                        {param.name}
                        {param.optional ? '?' : ''}:
                      </span>
                      <span className={styles.paramType}>
                        <TypeDoc type={param.type} depth={depth + 1} />
                      </span>
                      {paramIndex < signature.parameters.length - 1 && (
                        <span className={styles.paramComma}>, </span>
                      )}
                    </span>
                  ))}
                  )
                </span>
                <span className={styles.functionArrow}> =&gt; </span>
                <span className={styles.returnType}>
                  <TypeDoc type={signature.returnValueType} depth={depth + 1} />
                </span>
              </div>
            ))}
          </div>
        );

      case 'tuple':
        return (
          <div className={styles.tupleType}>
            [
            {t.types.map((memberType, index) => (
              <React.Fragment key={index}>
                {index > 0 && ', '}
                <TypeDoc type={memberType} depth={depth + 1} />
              </React.Fragment>
            ))}
            ]
          </div>
        );

      case 'enum':
        return (
          <div className={styles.enumType}>
            <div className={styles.enumName}>{t.typeName?.name || 'enum'}</div>
            {t.members.length > 0 && (
              <div className={styles.enumMembers}>
                {t.members.map((member) => (
                  <div key={member.name} className={styles.enumMember}>
                    <span className={styles.enumMemberName}>{member.name}</span>
                    <span className={styles.enumMemberValue}>= {JSON.stringify(member.value)}</span>
                    {member.documentation?.description && (
                      <div className={styles.enumMemberDoc}>{member.documentation.description}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'external':
        return (
          <span className={styles.externalType}>
            {t.typeName.namespaces ? `${t.typeName.namespaces?.join(' > ')}.` : ''}
            {t.typeName.name}
            {t.typeName.typeArguments && t.typeName.typeArguments.length > 0 && (
              <React.Fragment>
                {'<'}
                {t.typeName.typeArguments.map((arg, index) => (
                  <React.Fragment key={index}>
                    {index > 0 && ', '}
                    <TypeDoc type={arg.type} depth={depth + 1} />
                  </React.Fragment>
                ))}
                {'>'}
              </React.Fragment>
            )}
          </span>
        );

      case 'typeParameter':
        return (
          <div className={styles.typeParameterType}>
            <span className={styles.typeParameterName}>{t.name}</span>
            {t.constraint && (
              <span className={styles.typeParameterConstraint}>
                {' extends '}
                <TypeDoc type={t.constraint} depth={depth + 1} />
              </span>
            )}
            {t.defaultValue && (
              <span className={styles.typeParameterDefault}>
                {' = '}
                <TypeDoc type={t.defaultValue} depth={depth + 1} />
              </span>
            )}
          </div>
        );
      default:
        return <span className={styles.unknownType}>Unknown Type</span>;
    }
  };

  if (!showName || type.kind === 'external') {
    // For function and component types, return directly without wrapper since they have their own styling
    if (
      type.kind === 'function' ||
      type.kind === 'component' ||
      type.kind === 'union' ||
      type.kind === 'external'
    ) {
      return renderType(type);
    }
    return <div className={styles.typeDocWithoutName}>{renderType(type)}</div>;
  }

  const typeName = 'typeName' in type ? type.typeName?.name : undefined;

  // For function and component types, return directly without wrapper since they have their own styling
  if (
    type.kind === 'function' ||
    type.kind === 'component' ||
    type.kind === 'union' ||
    type.kind === 'intrinsic'
  ) {
    return (
      <React.Fragment>
        {typeName && <div className={styles.typeName}>{typeName}</div>}
        {renderType(type)}
      </React.Fragment>
    );
  }

  return (
    <div className={styles.typeDoc}>
      {typeName && <div className={styles.typeName}>{typeName}</div>}
      <div className={styles.typeContent}>{renderType(type)}</div>
    </div>
  );
}

function ComponentDoc(props: { type: ComponentTypeMeta }) {
  const { type } = props;

  return (
    <div className={styles.componentDoc}>
      <div className={styles.componentName}>{type.name}</div>
      <div className={styles.componentDescription}>{type.description}</div>
      {Object.keys(type.props).length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Prop</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(type.props).map((key) => {
              const prop = type.props[key];
              return (
                <tr key={key}>
                  <td>{key}</td>
                  <td>
                    <code>{prop.type}</code>
                  </td>
                  <td>{prop.description}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {Object.keys(type.dataAttributes).length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Data Attribute</th>
              <th>Description</th>
              <th>Default</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(type.dataAttributes).map((key) => {
              const dataAttr = type.dataAttributes[key];
              return (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{dataAttr.description}</td>
                  <td>
                    <code>{dataAttr.default}</code>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {Object.keys(type.cssVariables).length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>CSS Variable</th>
              <th>Description</th>
              <th>Default</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(type.cssVariables).map((key) => {
              const cssVar = type.cssVariables[key];
              return (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{cssVar.description}</td>
                  <td>
                    <code>{cssVar.default}</code>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function HookDoc(props: { type: HookTypeMeta }) {
  const { type } = props;

  const { name, description, parameters, returnValue } = type;

  return (
    <div className={styles.componentDoc}>
      <div className={styles.componentName}>{name}</div>
      {description && <div className={styles.componentDescription}>{description}</div>}
      {Object.keys(parameters).length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(parameters).map((key, i) => {
              const param = type.parameters[key];
              return (
                <tr key={param.name || i}>
                  <td>{param.name || i}</td>
                  <td>
                    <code>{param.type}</code>
                  </td>
                  <td>{param.description}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className={styles.returnType}>Return Type</div>
      {typeof returnValue === 'string' ? (
        <code>{returnValue}</code>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Key</th>
              <th>Type</th>
              <th>Required</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(returnValue).map((key) => {
              const returnValueValue = returnValue[key];
              return (
                <tr key={key}>
                  <td>{key}</td>
                  <td>
                    <code>{returnValueValue.type}</code>
                  </td>
                  <td>{returnValueValue.required ? 'Yes' : 'No'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function TypesTable(props: TypesTableProps) {
  const { types } = useTypes(props);

  const renderType = React.useCallback((type: TypesMeta) => {
    switch (type.type) {
      case 'component':
        return <ComponentDoc type={type.data} />;
      case 'hook':
        return <HookDoc type={type.data} />;
      default:
        return (
          <React.Fragment>
            <div className={styles.name}>{type.data.name}</div>
            {type.data.documentation && type.data.documentation.description && (
              <div className={styles.documentation}>{type.data.documentation.description}</div>
            )}
            <TypeDoc type={type.data.type} showName={false} />
          </React.Fragment>
        );
    }
  }, []);

  return (
    <div className={styles.root}>
      {types && types?.map((type, i) => <div key={i}>{renderType(type)}</div>)}
    </div>
  );
}
