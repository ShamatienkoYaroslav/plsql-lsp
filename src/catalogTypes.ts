export interface CatalogTable {
  tableName: string;
  comments?: string;
  columns: CatalogColumn[];
}

export interface CatalogColumn {
  columnName: string;
  dataType: string;
  dataLength?: number;
  dataPrecision?: number;
  dataScale?: number;
  nullable: boolean;
  comments?: string;
  tableName: string;
}

export interface CatalogObject {
  objectName: string;
  objectType: string;
  status: string;
}

export interface CatalogArgument {
  objectName: string;
  packageName?: string;
  argumentName: string;
  position: number;
  dataType: string;
  inOut: string;
}

export interface CatalogSource {
  name: string;
  type: string;
  lines: string[];
}

export interface CatalogCache {
  tables: Map<string, CatalogTable>;
  objects: Map<string, CatalogObject>;
  arguments: Map<string, CatalogArgument[]>;
  source: Map<string, CatalogSource>;
  lastRefreshed: number;
}
