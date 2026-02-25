'use client';

import * as React from 'react';
import { useTypes } from '@mui/internal-docs-infra/useTypes';
import type {
  ProcessedComponentTypeMeta,
  ProcessedHookTypeMeta,
  ProcessedFunctionTypeMeta,
  ProcessedClassTypeMeta,
  ProcessedMethod,
  ProcessedRawTypeMeta,
  ProcessedRawEnumMember,
  ProcessedTypesMeta,
} from '@mui/internal-docs-infra/useTypes';
import { TypesContentProps } from '@mui/internal-docs-infra/abstractCreateTypes';
import { Table } from '@/components/Table';
import styles from './TypesTable.module.css';

export type TypesTableProps = TypesContentProps<{}>;

export function TypesTable(props: TypesTableProps) {
  // Get the main type and additional types for this export
  const { type, additionalTypes } = useTypes(props);

  return (
    <div className={styles.typesTable}>
      {type && <TypeMetaDoc typeMeta={type} />}
      {additionalTypes.map((typeMeta: ProcessedTypesMeta) => (
        <details key={typeMeta.name} className={styles.additionalType}>
          <summary className={styles.additionalTypeSummary}>{typeMeta.name}</summary>
          <div id={typeMeta.slug}>
            <TypeMetaDoc typeMeta={typeMeta} showName={false} />
          </div>
        </details>
      ))}
    </div>
  );
}

function TypeMetaDoc(props: { typeMeta: ProcessedTypesMeta; showName?: boolean }) {
  const { typeMeta, showName = true } = props;

  if (typeMeta.type === 'component') {
    return <ComponentDoc type={typeMeta.data} showName={showName} />;
  }
  if (typeMeta.type === 'hook') {
    return <HookDoc type={typeMeta.data} showName={showName} />;
  }
  if (typeMeta.type === 'function') {
    return <FunctionDoc type={typeMeta.data} showName={showName} />;
  }
  if (typeMeta.type === 'class') {
    return <ClassDoc type={typeMeta.data} showName={showName} />;
  }
  if (typeMeta.type === 'raw') {
    return <RawDoc name={typeMeta.name} data={typeMeta.data} showName={showName} />;
  }
  return null;
}

function ComponentDoc(props: { type: ProcessedComponentTypeMeta; showName?: boolean }) {
  const { type, showName = true } = props;

  return (
    <div className={styles.componentDoc}>
      {showName && <div className={styles.componentName}>{type.name}</div>}
      <div className={styles.componentDescription}>{type.description}</div>
      {Object.keys(type.props).length > 0 && (
        <Table>
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
                  <td data-nowrap>{key}</td>
                  <td>{prop.type}</td>
                  <td>{prop.description}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {Object.keys(type.dataAttributes).length > 0 && (
        <Table>
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
                  <td data-nowrap>{key}</td>
                  <td>{dataAttr.description}</td>
                  <td>
                    {dataAttr.default !== undefined && (
                      <code>{JSON.stringify(dataAttr.default)}</code>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {Object.keys(type.cssVariables).length > 0 && (
        <Table>
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
                  <td data-nowrap>{key}</td>
                  <td>{cssVar.description}</td>
                  <td>
                    {cssVar.default !== undefined && <code>{JSON.stringify(cssVar.default)}</code>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function HookDoc(props: { type: ProcessedHookTypeMeta; showName?: boolean }) {
  const { type, showName = true } = props;

  const { name, description, parameters, properties, returnValue } = type;
  const paramsOrProps = properties ?? parameters ?? {};
  const isProperties = Boolean(properties);

  return (
    <div className={styles.componentDoc}>
      {showName && <div className={styles.componentName}>{name}</div>}
      {description && <div className={styles.componentDescription}>{description}</div>}
      {Object.keys(paramsOrProps).length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>{isProperties ? 'Property' : 'Parameter'}</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(paramsOrProps).map((key) => {
              const param = paramsOrProps[key];
              return (
                <tr key={key}>
                  <td data-nowrap>{key}</td>
                  <td>{param.type}</td>
                  <td>{param.description}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <div className={styles.returnType}>Return Type</div>
      {(() => {
        if (!returnValue) {
          return null;
        }

        // Use discriminated union for type-safe checks
        if (returnValue.kind === 'simple') {
          return (
            <div>
              <div>{returnValue.type}</div>
              {returnValue.description && <div>{returnValue.description}</div>}
            </div>
          );
        }

        // returnValue.kind === 'object'
        return (
          <React.Fragment>
            {returnValue.typeName && (
              <div>
                <code>{returnValue.typeName}</code>
              </div>
            )}
            <Table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Type</th>
                  <th>Required</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(returnValue.properties).map((key) => {
                  const prop = returnValue.properties[key];
                  return (
                    <tr key={key}>
                      <td data-nowrap>{key}</td>
                      <td>{prop.type}</td>
                      <td>{prop.required ? 'Yes' : 'No'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </React.Fragment>
        );
      })()}
    </div>
  );
}

function FunctionDoc(props: { type: ProcessedFunctionTypeMeta; showName?: boolean }) {
  const { type, showName = true } = props;

  const { name, description, parameters, properties, returnValue } = type;
  const paramsOrProps = properties ?? parameters ?? {};
  const isProperties = Boolean(properties);

  return (
    <div className={styles.componentDoc}>
      {showName && <div className={styles.componentName}>{name}</div>}
      {description && <div className={styles.componentDescription}>{description}</div>}
      {Object.keys(paramsOrProps).length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>{isProperties ? 'Property' : 'Parameter'}</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(paramsOrProps).map((key) => {
              const param = paramsOrProps[key];
              return (
                <tr key={key}>
                  <td data-nowrap>{key}</td>
                  <td>{param.type}</td>
                  <td>{param.description}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <div className={styles.returnType}>Return Type</div>
      {(() => {
        if (!returnValue) {
          return null;
        }

        // Use discriminated union for type-safe checks
        if (returnValue.kind === 'simple') {
          return (
            <div>
              <div>{returnValue.type}</div>
              {returnValue.description && <div>{returnValue.description}</div>}
            </div>
          );
        }

        // returnValue.kind === 'object'
        return (
          <React.Fragment>
            {returnValue.typeName && (
              <div>
                <code>{returnValue.typeName}</code>
              </div>
            )}
            <Table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Type</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(returnValue.properties).map((key) => {
                  const prop = returnValue.properties[key];
                  return (
                    <tr key={key}>
                      <td data-nowrap>{key}</td>
                      <td>{prop.type}</td>
                      <td>{prop.description}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </React.Fragment>
        );
      })()}
    </div>
  );
}

function ClassDoc(props: { type: ProcessedClassTypeMeta; showName?: boolean }) {
  const { type, showName = true } = props;

  const { name, description, constructorParameters, properties, methods } = type;

  return (
    <div className={styles.componentDoc}>
      {showName && <div className={styles.componentName}>{name}</div>}
      {description && <div className={styles.componentDescription}>{description}</div>}
      {/* Static Methods first - often factory methods */}
      {Object.keys(methods).length > 0 &&
        (() => {
          const methodEntries = Object.entries(methods) as [string, ProcessedMethod][];
          const staticMethods = methodEntries.filter(([, m]) => m.isStatic);
          return renderMethodsSection('Static Methods', staticMethods);
        })()}
      {Object.keys(constructorParameters).length > 0 && (
        <React.Fragment>
          <div className={styles.returnType}>Constructor Parameters</div>
          <Table>
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Type</th>
                <th>Default</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(constructorParameters).map((key) => {
                const param = constructorParameters[key];
                return (
                  <tr key={key}>
                    <td data-nowrap>{key}</td>
                    <td>{param.type}</td>
                    <td>{param.default}</td>
                    <td>{param.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </React.Fragment>
      )}
      {Object.keys(properties).length > 0 && (
        <React.Fragment>
          <div className={styles.returnType}>Properties</div>
          <Table>
            <thead>
              <tr>
                <th>Property</th>
                <th>Type</th>
                <th>Modifiers</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(properties).map((key) => {
                const prop = properties[key];
                const modifiers: string[] = [];
                if (prop.isStatic) {
                  modifiers.push('static');
                }
                if (prop.readonly) {
                  modifiers.push('readonly');
                }
                return (
                  <tr key={key}>
                    <td data-nowrap>{key}</td>
                    <td>{prop.type}</td>
                    <td>{modifiers.join(', ') || '-'}</td>
                    <td>{prop.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </React.Fragment>
      )}
      {/* Instance Methods */}
      {Object.keys(methods).length > 0 &&
        (() => {
          const methodEntries = Object.entries(methods) as [string, ProcessedMethod][];
          const instanceMethods = methodEntries.filter(([, m]) => !m.isStatic);
          return renderMethodsSection('Methods', instanceMethods);
        })()}
    </div>
  );

  function renderMethodsSection(title: string, methodEntries: [string, ProcessedMethod][]) {
    if (methodEntries.length === 0) {
      return null;
    }
    return (
      <React.Fragment>
        <div className={styles.returnType}>{title}</div>
        {methodEntries.map(([key, method]) => (
          <div key={key} className={styles.methodDoc}>
            <div className={styles.methodName}>{key}</div>
            {method.description && (
              <div className={styles.methodDescription}>{method.description}</div>
            )}
            {Object.keys(method.parameters).length > 0 && (
              <Table>
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th>Type</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(method.parameters).map((paramKey) => {
                    const param = method.parameters[paramKey];
                    return (
                      <tr key={paramKey}>
                        <td data-nowrap>{paramKey}</td>
                        <td>{param.type}</td>
                        <td>{param.description}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
            {method.returnValue && (
              <div>
                <strong>Returns:</strong> {method.returnValue}
                {method.returnValueDescription && <span> — {method.returnValueDescription}</span>}
              </div>
            )}
          </div>
        ))}
      </React.Fragment>
    );
  }
}

function RawDoc(props: { name: string; data: ProcessedRawTypeMeta; showName?: boolean }) {
  const { name, data, showName = true } = props;

  return (
    <div className={styles.componentDoc}>
      {showName && <div className={styles.componentName}>{name}</div>}
      {data.description && <div className={styles.componentDescription}>{data.description}</div>}
      {data.formattedCode && <div className={styles.typeContent}>{data.formattedCode}</div>}
      {data.enumMembers && data.enumMembers.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Value</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {data.enumMembers.map((member: ProcessedRawEnumMember) => (
              <tr key={member.name}>
                <td data-nowrap>{member.name}</td>
                <td>{member.value}</td>
                <td>{member.description}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
