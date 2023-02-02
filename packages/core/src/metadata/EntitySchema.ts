import type { AnyEntity, Constructor, DeepPartial, Dictionary, EntityName, EntityProperty, ExcludeFunctions, ExpandProperty } from '../typings';
import { EntityMetadata } from '../typings';
import type {
  EmbeddedOptions, EnumOptions, IndexOptions, ManyToManyOptions, ManyToOneOptions, OneToManyOptions, OneToOneOptions, PrimaryKeyOptions, PropertyOptions,
  SerializedPrimaryKeyOptions, UniqueOptions,
} from '../decorators';
import type { EntityRepository } from '../entity/EntityRepository';
import { BaseEntity } from '../entity/BaseEntity';
import { Cascade, ReferenceKind } from '../enums';
import { Type } from '../types';
import { Utils } from '../utils';
import { EnumArrayType } from '../types/EnumArrayType';

type TypeType = string | NumberConstructor | StringConstructor | BooleanConstructor | DateConstructor | ArrayConstructor | Constructor<Type<any>> | Type<any>;
type TypeDef<T> = { type: TypeType } | { entity: string | (() => string | EntityName<T>) };
type Property<T, O> =
  | ({ kind: ReferenceKind.MANY_TO_ONE | 'm:1' } & TypeDef<T> & ManyToOneOptions<T, O>)
  | ({ kind: ReferenceKind.ONE_TO_ONE | '1:1' } & TypeDef<T> & OneToOneOptions<T, O>)
  | ({ kind: ReferenceKind.ONE_TO_MANY | '1:m' } & TypeDef<T> & OneToManyOptions<T, O>)
  | ({ kind: ReferenceKind.MANY_TO_MANY | 'm:n' } & TypeDef<T> & ManyToManyOptions<T, O>)
  | ({ kind: ReferenceKind.EMBEDDED | 'embedded' } & TypeDef<T> & EmbeddedOptions & PropertyOptions<O>)
  | ({ enum: true } & EnumOptions<O>)
  | (TypeDef<T> & PropertyOptions<O>);
type Metadata<T, U> =
  & Omit<Partial<EntityMetadata<T>>, 'name' | 'properties'>
  & ({ name: string } | { class: Constructor<T>; name?: string })
  & { properties?: { [K in keyof Omit<T, keyof U> as ExcludeFunctions<Omit<T, keyof U>, K>]-?: Property<ExpandProperty<NonNullable<T[K]>>, T> } };

export class EntitySchema<T = any, U = never> {

  /**
   * When schema links the entity class via `class` option, this registry allows the lookup from opposite side,
   * so we can use the class in `entities` option just like the EntitySchema instance.
   */
  static REGISTRY = new Map<AnyEntity, EntitySchema>();

  private readonly _meta: EntityMetadata<T> = new EntityMetadata<T>();
  private internal = false;
  private initialized = false;

  constructor(meta: Metadata<T, U>) {
    meta.name = meta.class ? meta.class.name : meta.name;

    if (meta.name) {
      meta.abstract ??= false;
    }

    if (meta.class && !(meta as Dictionary).internal) {
      EntitySchema.REGISTRY.set(meta.class, this);
    }

    if (meta.tableName || meta.collection) {
      Utils.renameKey(meta, 'tableName', 'collection');
      meta.tableName = meta.collection;
    }

    Object.assign(this._meta, { className: meta.name }, meta);
    this._meta.root ??= this._meta;
  }

  static fromMetadata<T = AnyEntity, U = never>(meta: EntityMetadata<T> | DeepPartial<EntityMetadata<T>>): EntitySchema<T, U> {
    const schema = new EntitySchema<T, U>({ ...meta, internal: true } as unknown as Metadata<T, U>);
    schema.internal = true;

    return schema;
  }

  addProperty(name: string & keyof T, type?: TypeType, options: PropertyOptions<T> | EntityProperty = {}): void {
    const rename = <U> (data: U, from: string, to: string): void => {
      if (options[from] && !options[to]) {
        options[to] = [options[from]];
        delete options[from];
      }
    };

    if (name !== options.name) {
      Utils.renameKey(options, 'name', 'fieldName');
    }

    rename(options, 'fieldName', 'fieldNames');
    rename(options, 'ref', 'wrappedReference');
    rename(options, 'joinColumn', 'joinColumns');
    rename(options, 'inverseJoinColumn', 'inverseJoinColumns');
    rename(options, 'referenceColumnName', 'referencedColumnNames');
    rename(options, 'columnType', 'columnTypes');

    const prop = { name, kind: ReferenceKind.SCALAR, ...options, type: this.normalizeType(options, type) } as EntityProperty<T>;

    if (type && Type.isMappedType((type as Constructor).prototype)) {
      prop.type = type as string;
    }

    if (Utils.isString(prop.formula)) {
      const formula = prop.formula as string; // tmp var is needed here
      prop.formula = () => formula;
    }

    if (prop.formula) {
      prop.persist ??= false;
    }

    this._meta.properties[name] = prop;
  }

  addEnum(name: string & keyof T, type?: TypeType, options: EnumOptions<T> = {}): void {
    if (options.items instanceof Function) {
      options.items = Utils.extractEnumValues(options.items());
    }

    // enum arrays are simple numeric/string arrays, the constraint is enforced in the custom type only
    if (options.array && !options.type) {
      options.type = new EnumArrayType(`${this._meta.className}.${name}`, options.items);
      (options as EntityProperty).enum = false;
    }

    const prop = { enum: true, ...options };

    if (prop.array) {
      prop.enum = false;
    }

    this.addProperty(name, this.internal ? type : type || 'enum', prop);
  }

  addVersion(name: string & keyof T, type: TypeType, options: PropertyOptions<T> = {}): void {
    this.addProperty(name, type, { version: true, ...options });
  }

  addPrimaryKey(name: string & keyof T, type: TypeType, options: PrimaryKeyOptions<T> = {}): void {
    this.addProperty(name, type, { primary: true, ...options });
  }

  addSerializedPrimaryKey(name: string & keyof T, type: TypeType, options: SerializedPrimaryKeyOptions<T> = {}): void {
    this._meta.serializedPrimaryKey = name;
    this.addProperty(name, type, options);
  }

  addEmbedded<K = AnyEntity>(name: string & keyof T, options: EmbeddedOptions): void {
    Utils.defaultValue(options, 'prefix', true);

    if (options.array) {
      options.object = true; // force object mode for arrays
    }

    this._meta.properties[name] = {
      name,
      type: this.normalizeType(options),
      kind: ReferenceKind.EMBEDDED,
      ...options,
    } as EntityProperty<T>;
  }

  addManyToOne<K = AnyEntity>(name: string & keyof T, type: TypeType, options: ManyToOneOptions<K, T>): void {
    const prop = this.createProperty(ReferenceKind.MANY_TO_ONE, options);
    prop.owner = true;

    if (prop.joinColumns && !prop.fieldNames) {
      prop.fieldNames = prop.joinColumns;
    }

    if (prop.fieldNames && !prop.joinColumns) {
      prop.joinColumns = prop.fieldNames;
    }

    this.addProperty(name, type, prop);
  }

  addManyToMany<K = AnyEntity>(name: string & keyof T, type: TypeType, options: ManyToManyOptions<K, T>): void {
    options.fixedOrder = options.fixedOrder || !!options.fixedOrderColumn;

    if (!options.owner && !options.mappedBy) {
      options.owner = true;
    }

    if (options.owner) {
      Utils.renameKey(options, 'mappedBy', 'inversedBy');
    }

    const prop = this.createProperty(ReferenceKind.MANY_TO_MANY, options);
    this.addProperty(name, type, prop);
  }

  addOneToMany<K = AnyEntity>(name: string & keyof T, type: TypeType, options: OneToManyOptions<K, T>): void {
    const prop = this.createProperty<T>(ReferenceKind.ONE_TO_MANY, options);
    this.addProperty(name, type, prop);
  }

  addOneToOne<K = AnyEntity>(name: string & keyof T, type: TypeType, options: OneToOneOptions<K, T>): void {
    const prop = this.createProperty(ReferenceKind.ONE_TO_ONE, options) as EntityProperty;
    Utils.defaultValue(prop, 'owner', !!prop.inversedBy || !prop.mappedBy);
    Utils.defaultValue(prop, 'unique', prop.owner);

    if (prop.owner && options.mappedBy) {
      Utils.renameKey(prop, 'mappedBy', 'inversedBy');
    }

    if (prop.joinColumns && !prop.fieldNames) {
      prop.fieldNames = prop.joinColumns;
    }

    if (prop.fieldNames && !prop.joinColumns) {
      prop.joinColumns = prop.fieldNames;
    }

    this.addProperty(name, type, prop);
  }

  addIndex<T>(options: Required<Omit<IndexOptions<T>, 'name' | 'type' | 'options' | 'expression'>> & { name?: string; expression?: string; options?: Dictionary }): void {
    this._meta.indexes.push(options as any);
  }

  addUnique<T>(options: Required<Omit<UniqueOptions<T>, 'name' | 'options' | 'expression'>> & { name?: string; options?: Dictionary }): void {
    this._meta.uniques.push(options as any);
  }

  setCustomRepository(repository: () => Constructor): void {
    this._meta.customRepository = repository as () => Constructor<EntityRepository<any>>;
  }

  setExtends(base: string): void {
    this._meta.extends = base;
  }

  setClass(proto: Constructor<T>) {
    this._meta.class = proto;
    this._meta.prototype = proto.prototype;
    this._meta.className = proto.name;
    this._meta.constructorParams = Utils.getParamNames(proto, 'constructor');
    this._meta.toJsonParams = Utils.getParamNames(proto, 'toJSON').filter(p => p !== '...args');

    if (!this.internal) {
      EntitySchema.REGISTRY.set(proto, this);
    }

    if (Object.getPrototypeOf(proto) !== BaseEntity) {
      this._meta.extends = this._meta.extends || Object.getPrototypeOf(proto).name || undefined;
    }
  }

  get meta() {
    return this._meta;
  }

  get name(): EntityName<T>  {
    return this._meta.name!;
  }

  /**
   * @internal
   */
  init() {
    if (this.initialized) {
      return this;
    }

    if (!this._meta.class) {
      const name = this.name as string;
      this._meta.class = ({ [name]: class {} })[name] as Constructor<T>;
    }

    this.setClass(this._meta.class);

    if (this._meta.abstract && !this._meta.discriminatorColumn) {
      delete this._meta.name;
    }

    const tableName = this._meta.collection ?? this._meta.tableName;

    if (tableName?.includes('.') && !this._meta.schema) {
      this._meta.schema = tableName.substring(0, tableName.indexOf('.'));
      this._meta.collection = tableName.substring(tableName.indexOf('.') + 1);
    }

    this.initProperties();
    this.initPrimaryKeys();
    this._meta.props = Object.values(this._meta.properties);
    this._meta.relations = this._meta.props.filter(prop => prop.kind !== ReferenceKind.SCALAR && prop.kind !== ReferenceKind.EMBEDDED);
    this.initialized = true;

    return this;
  }

  private initProperties(): void {
    Object.entries<Property<T, unknown>>(this._meta.properties as Dictionary).forEach(([name, options]) => {
      if (Type.isMappedType(options.type)) {
        options.type ??= options.type?.constructor.name;
      }

      switch ((options as EntityProperty).kind) {
        case ReferenceKind.ONE_TO_ONE:
          this.addOneToOne(name as keyof T & string, options.type as string, options as OneToOneOptions<T, T>);
          break;
        case ReferenceKind.ONE_TO_MANY:
          this.addOneToMany(name as keyof T & string, options.type as string, options as OneToManyOptions<T, T>);
          break;
        case ReferenceKind.MANY_TO_ONE:
          this.addManyToOne(name as keyof T & string, options.type as string, options as ManyToOneOptions<T, T>);
          break;
        case ReferenceKind.MANY_TO_MANY:
          this.addManyToMany(name as keyof T & string, options.type as string, options as ManyToManyOptions<T, T>);
          break;
        case ReferenceKind.EMBEDDED:
          this.addEmbedded(name as keyof T & string, options as EmbeddedOptions);
          break;
        default:
          if ((options as EntityProperty).enum) {
            this.addEnum(name as keyof T & string, options.type as string, options);
          } else if (options.primary) {
            this.addPrimaryKey(name as keyof T & string, options.type as string, options);
          } else if (options.serializedPrimaryKey) {
            this.addSerializedPrimaryKey(name as keyof T & string, options.type as string, options);
          } else if (options.version) {
            this.addVersion(name as keyof T & string, options.type as string, options);
          } else {
            this.addProperty(name as keyof T & string, options.type as string, options);
          }
      }
    });
  }

  private initPrimaryKeys(): void {
    const pks = Object.values<EntityProperty<T>>(this._meta.properties).filter(prop => prop.primary);

    if (pks.length > 0) {
      this._meta.primaryKeys = pks.map(prop => prop.name);
      this._meta.compositePK = pks.length > 1;
    }

    // FK used as PK, we need to cascade
    if (pks.length === 1 && pks[0].kind !== ReferenceKind.SCALAR) {
      pks[0].onDelete = 'cascade';
    }

    if (pks.length === 1 && pks[0].type === 'number') {
      pks[0].autoincrement ??= true;
    }

    const serializedPrimaryKey = Object.values<EntityProperty<T>>(this._meta.properties).find(prop => prop.serializedPrimaryKey);

    if (serializedPrimaryKey) {
      this._meta.serializedPrimaryKey = serializedPrimaryKey.name;
    }
  }

  private normalizeType(options: PropertyOptions<T> | EntityProperty, type?: string | any | Constructor<Type>) {
    if ('entity' in options) {
      if (Utils.isString(options.entity)) {
        type = options.type = options.entity;
      } else if (options.entity) {
        const tmp = options.entity();
        type = options.type = Array.isArray(tmp) ? tmp.map(t => Utils.className(t)).sort().join(' | ') : Utils.className(tmp);
      }
    }

    if (type instanceof Function) {
      type = type.name;
    }

    if (['String', 'Number', 'Boolean', 'Array'].includes(type)) {
      type = type.toLowerCase();
    }

    return type;
  }

  private createProperty<T>(kind: ReferenceKind, options: PropertyOptions<T> | EntityProperty): EntityProperty<T> {
    return {
      kind,
      cascade: [Cascade.PERSIST],
      ...options,
    } as EntityProperty<T>;
  }

}
