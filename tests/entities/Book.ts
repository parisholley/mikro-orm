import { ObjectId } from 'bson';
import { EntityDTO, Ref, Dictionary, Collection, Cascade, Entity, Index, ManyToMany, ManyToOne, PrimaryKey, Property, Unique, wrap, Filter, OptionalProps } from '@mikro-orm/core';
import { Publisher } from './Publisher';
import { Author } from './Author';
import { BookTag } from './book-tag';
import { BaseEntity3 } from './BaseEntity3';
import { BookRepository } from '../repositories/BookRepository';

@Entity({ tableName: 'books-table', repository: () => BookRepository })
@Unique({ properties: ['title', 'author'] })
@Index({ properties: 'title', type: 'fulltext' })
@Index({ options: { point: '2dsphere', title: -1 } })
@Filter({ name: 'writtenBy', cond: args => ({ author: args.author }) })
export class Book extends BaseEntity3 {

  [OptionalProps]?: 'createdAt';

  @Property()
  createdAt: Date = new Date();

  @Property()
  title: string;

  @Property({ lazy: true, nullable: true })
  perex?: string;

  @ManyToOne(() => Author)
  author: Author;

  @ManyToOne(() => Publisher, { ref: true, cascade: [Cascade.PERSIST, Cascade.REMOVE], nullable: true })
  @Index({ name: 'publisher_idx' })
  publisher!: Ref<Publisher> | null;

  @ManyToMany(() => BookTag)
  tags = new Collection<BookTag>(this);

  @Property({ type: 'json', nullable: true })
  metaObject?: Dictionary<unknown>;

  @Property({ nullable: true })
  metaArray?: any[];

  @Property({ nullable: true })
  metaArrayOfStrings?: string[];

  @Property({ nullable: true })
  @Index({ type: '2dsphere' })
  point?: [number, number];

  @Property({ nullable: true })
  tenant?: number;

  constructor(title: string, author?: Author) {
    super();
    this.title = title;
    this.author = author!;
  }

  toJSON<T extends this = this>(strict = true, strip: string[] = ['metaObject', 'metaArray', 'metaArrayOfStrings'], ...args: any[]): EntityDTO<T> {
    const o = wrap(this as T).toObject(...args);

    if (strict) {
      strip.forEach(k => delete o[k as keyof typeof o]);
    }

    return o;
  }

}
