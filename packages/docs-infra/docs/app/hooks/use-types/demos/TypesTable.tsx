import React from 'react';
import { TypesMeta, useTypes } from '@mui/internal-docs-infra/useTypes';
import styles from './TypesTable.module.css';
import { AnyType } from 'typescript-api-extractor';

export type TypesTableProps = TypesMeta & {
  size: 'small' | 'medium' | 'large';
  name?: string;
  displayName?: string;
};

export function TypeDoc(props: { type: AnyType; depth?: number }) {
  const { type, depth = 0 } = props;
  const maxDepth = 3; // Prevent infinite recursion

  if (depth > maxDepth) {
    return <div className={styles.typeDoc}>...</div>;
  }

  const renderType = (type: AnyType): React.ReactNode => {
    switch (type.kind) {
      case 'intrinsic':
        return <span className={styles.intrinsicType}>{type.intrinsic}</span>;

      case 'literal':
        return <span className={styles.literalType}>{JSON.stringify(type.value)}</span>;

      case 'array':
        return (
          <div className={styles.arrayType}>
            <TypeDoc type={type.elementType} depth={depth + 1} />
            []
          </div>
        );

      case 'union':
        return (
          <div className={styles.unionType}>
            {type.types.map((memberType, index) => (
              <React.Fragment key={index}>
                {index > 0 && <span className={styles.unionSeparator}> | </span>}
                <TypeDoc type={memberType} depth={depth + 1} />
              </React.Fragment>
            ))}
          </div>
        );

      case 'intersection':
        return (
          <div className={styles.intersectionType}>
            {type.types.map((memberType, index) => (
              <React.Fragment key={index}>
                {index > 0 && <span className={styles.intersectionSeparator}> & </span>}
                <TypeDoc type={memberType} depth={depth + 1} />
              </React.Fragment>
            ))}
          </div>
        );

      case 'object':
        if (type.properties.length === 0) {
          return <span className={styles.intrinsicType}>{'{}'}</span>;
        }
        return (
          <div className={styles.objectType}>
            <div className={styles.objectBrace}>{'{'}</div>
            <div className={styles.objectProperties}>
              {type.properties.map((prop) => (
                <div key={prop.name} className={styles.property}>
                  <div>
                    <span className={styles.propertyName}>
                      {prop.name}
                      {prop.optional ? '?' : ''}:
                    </span>
                    <span className={styles.propertyType}>
                      <TypeDoc type={prop.type} depth={depth + 1} />
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
            {type.props.length > 0 && (
              <div className={styles.componentProps}>
                {type.props.map((prop) => (
                  <div key={prop.name} className={styles.property}>
                    <div>
                      <span className={styles.propertyName}>
                        {prop.name}
                        {prop.optional ? '?' : ''}:
                      </span>
                      <span className={styles.propertyType}>
                        <TypeDoc type={prop.type} depth={depth + 1} />
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
            {type.callSignatures.map((signature, index) => (
              <div key={index} className={styles.callSignature}>
                <span className={styles.functionParams}>
                  (
                  {signature.parameters.map((param, paramIndex) => (
                    <React.Fragment key={param.name}>
                      {paramIndex > 0 && ', '}
                      <span className={styles.paramName}>
                        {param.name}
                        {param.optional ? '?' : ''}:
                      </span>
                      <span className={styles.paramType}>
                        <TypeDoc type={param.type} depth={depth + 1} />
                      </span>
                    </React.Fragment>
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
            {type.types.map((memberType, index) => (
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
            <div className={styles.enumName}>{type.typeName?.name || 'enum'}</div>
            {type.members.length > 0 && (
              <div className={styles.enumMembers}>
                {type.members.map((member) => (
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
        return <span className={styles.externalType}>{type.typeName.toString()}</span>;

      case 'typeParameter':
        return (
          <div className={styles.typeParameterType}>
            <span className={styles.typeParameterName}>{type.name}</span>
            {type.constraint && (
              <span className={styles.typeParameterConstraint}>
                {' extends '}
                <TypeDoc type={type.constraint} depth={depth + 1} />
              </span>
            )}
            {type.defaultValue && (
              <span className={styles.typeParameterDefault}>
                {' = '}
                <TypeDoc type={type.defaultValue} depth={depth + 1} />
              </span>
            )}
          </div>
        );
    }
  };

  const typeName = 'typeName' in type ? type.typeName?.name : undefined;

  return (
    <div className={styles.typeDoc}>
      {typeName && <div className={styles.typeName}>{typeName}</div>}
      <div className={styles.typeContent}>{renderType(type)}</div>
    </div>
  );
}

export function TypesTable(props: TypesTableProps) {
  const { types } = useTypes(props);

  return (
    <div className={styles.root}>
      {types &&
        types.exports?.map(({ name, type, documentation }) => (
          <div key={name}>
            <div className={styles.name}>{name}</div>
            {documentation && documentation.description && (
              <div className={styles.documentation}>{documentation.description}</div>
            )}
            <TypeDoc type={type} />
          </div>
        ))}
    </div>
  );
}
