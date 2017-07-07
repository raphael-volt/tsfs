import {Observable, Observer, Subscription} from "rxjs";
import * as fs from 'fs'
import * as path from 'path'
import * as os from "os"
import * as mustache from "mustache"
const isWin: boolean = process.platform == "win32"
const pathSeparator: RegExp = isWin ? /\\/ : /\//

const INDEX_TEMPLATE: string = `{{#imports}}
export * from './{{.}}'
{{/imports}}`

class SubscibeHelper {

    private _subscription: Subscription
    private _observer: Observer<any>

    set add(value: Subscription) {
        this._subscription = value
    }

    set observer(value: Observer<any>) {
        this._observer = value
    }

    get closed(): boolean | undefined {
        return this._subscription ? this._subscription.closed : undefined
    }

    unsubscribe() {
        const sub: Subscription = this._subscription
        if (sub && !sub.closed)
            sub.unsubscribe()
        this._subscription = undefined
    }

    error(error: Error | string) {
        if (error instanceof Error == false)
            error = new Error(String(error))
        this.unsubscribe()
        const observer: Observer<any> = this._observer
        if (observer)
            return observer.error(error)
        throw error
    }
}


export class FileStats {
    constructor(
        public path: string = undefined,
        public basename: string = undefined,
        public stats: fs.Stats = undefined) {
    }
}

export class FileStatsTree {
    [depth: number]: FileStats[]
}

export class TreeItem {
    constructor(
        public depth: number,
        public stats: FileStats,
        public files: TreeItem[] = [],
        public dirs: TreeItem[] = []) {}
}

export class tsfs {

    static existsAsync(filename: string): Observable<boolean> {
        return Observable.create((observer: Observer<boolean>) => {
            fs.exists(filename, (exists: boolean) => {
                observer.next(exists)
                observer.complete()
            })
        })
    }

    static statsAsync(filename: string, basename?: string): Observable<FileStats> {
        return Observable.create((observer: Observer<FileStats>) => {
            let result: FileStats = new FileStats(filename, basename ? basename : path.basename(filename))
            fs.lstat(filename, (err: NodeJS.ErrnoException, stats: fs.Stats) => {
                if (err)
                    return observer.error(err)
                result.stats = stats
                observer.next(result)
                observer.complete()
            })
        })
    }

    static findAsync(dirname: string): Observable<FileStats> {
        return Observable.create((observer: Observer<FileStats>) => {

            let searchBreak: boolean = false
            let sub: SubscibeHelper = new SubscibeHelper()
            sub.observer = observer

            fs.readdir(dirname, (error: NodeJS.ErrnoException, files: string[]) => {
                if (error)
                    return observer.error(error)
                let next = () => {
                    if (files.length && !searchBreak) {
                        const basename: string = files.shift()
                        sub.add = tsfs.statsAsync(path.join(dirname, basename), basename).subscribe(
                            fileStats => observer.next(fileStats),
                            sub.error,
                            () => {
                                sub.unsubscribe()
                                next()
                            }
                        )
                    }
                    else {
                        sub.observer = undefined
                        if (!searchBreak)
                            observer.complete()
                    }
                }
                next()
            })
            return () => {
                sub.unsubscribe()
                sub.observer = undefined
                searchBreak = true
            }
        })
    }

    static readDirAsync(dirname: string): Observable<FileStats[]> {
        return Observable.create((observer: Observer<FileStats[]>) => {
            const result: FileStats[] = []
            fs.readdir(dirname, (error: NodeJS.ErrnoException, files: string[]) => {
                if (error)
                    return observer.error(error)
                let sub: SubscibeHelper = new SubscibeHelper()
                sub.observer = observer
                let next = () => {
                    if (files.length) {
                        const basename: string = files.shift()
                        sub.add = tsfs.statsAsync(path.join(dirname, basename), basename)
                            .subscribe(
                            fileStats => {
                                result.push(fileStats)
                            },
                            sub.error,
                            () => {
                                sub.unsubscribe()
                                next()
                            }
                            )
                    }
                    else {
                        sub.observer = undefined
                        observer.next(result)
                        observer.complete()
                    }
                }
                next()
            })
        })
    }

    static deleteTsIndex(dirname): Observable<boolean> {
        return Observable.create((observer: Observer<boolean>) => {
            let sub: SubscibeHelper = new SubscibeHelper()
            sub.observer = observer
            const TS_RE: RegExp = /^index.ts$/
            let files: string[] = []
            sub.add = tsfs.findRecurseAsync(dirname, true).subscribe(
                (fileStats: FileStats) => {
                    if (TS_RE.test(fileStats.basename))
                        files.push(fileStats.path)
                },
                sub.error,
                () => {
                    let next = (error?: NodeJS.ErrnoException) => {
                        if(error)
                            return sub.error(error)
                        
                        if(files.length)
                            fs.unlink(files.shift(), next)
                        else {
                            sub.unsubscribe()
                            observer.next(true)
                            observer.complete()
                        }
                    }
                    next()
                }
            )
        })
    }
    static generateTsIndex(dirname): Observable<boolean> {

        return Observable.create((observer: Observer<boolean>) => {
            let sub: SubscibeHelper = new SubscibeHelper()
            sub.observer = observer
            const TS_RE: RegExp = /.ts$/
            const TS_SPEC_RE: RegExp = /.spec.ts$/
            let map: {
                [dir: string]: FileStats[]
            } = {}
            sub.add = tsfs.findRecurseAsync(dirname, true).subscribe(
                (fileStat: FileStats) => {
                    if (!TS_RE.test(fileStat.basename) || TS_SPEC_RE.test(fileStat.basename) || fileStat.basename == "index.ts")
                        return
                    const dir: string = path.dirname(fileStat.path)
                    if (map[dir] == undefined)
                        map[dir] = []
                    map[dir].push(fileStat)
                },
                sub.error,
                () => {
                    sub.unsubscribe()
                    let indexMap: {dir: string, imports: string[]}[] = []
                    let item: {dir: string, imports: string[]}
                    for (let dir in map) {
                        item = {dir: dir, imports: []}
                        for (let stats of map[dir]) {
                            item.imports.push(stats.basename.slice(0, -3))
                        }
                        item.imports.sort()
                        indexMap.push(item)
                    }

                    let next = () => {
                        if (indexMap.length) {
                            item = indexMap.shift()
                            fs.writeFile(
                                path.join(item.dir, "index.ts"),
                                mustache.render(INDEX_TEMPLATE, item),
                                (error: NodeJS.ErrnoException) => {
                                    next()
                                }
                            )
                        }
                        else {
                            observer.next(true)
                            observer.complete()
                        }
                    }
                    next()
                }
            )
        })
    }

    static treeAsync(dirname: string): Observable<FileStatsTree> {
        return Observable.create((observer: Observer<FileStatsTree>) => {
            let sub: SubscibeHelper = new SubscibeHelper()
            sub.observer = observer
            sub.add = tsfs.validateRoot(dirname).subscribe(
                (root: FileStats) => {
                    sub.unsubscribe()
                    tsfs._treeAsync(root, observer, sub)
                },
                sub.error
            )

        })
    }

    static hierarchicalTree(tree: FileStatsTree): TreeItem {
        let depthMap: number[] = []
        let depth: any
        for (depth in tree) {
            let d: number = Number(depth)
            if (depthMap.indexOf(d) == -1)
                depthMap.push(d)
        }
        let stats: FileStats = tree[depthMap[0]][0]

        let d: number = depthMap[0]
        let root = new TreeItem(d, stats)

        let nextDepth = (parent: TreeItem) => {

            let depth: number = parent.depth + 1
            if (tree[depth] == undefined)
                return
            let children: FileStats[] = tree[depth]
            for (let child of children) {
                if (path.dirname(child.path) != parent.stats.path) {
                    continue
                }
                let item: TreeItem = new TreeItem(depth, child)
                if (child.stats.isDirectory()) {
                    parent.dirs.push(item)
                    nextDepth(item)
                } else {
                    parent.files.push(item)
                }
            }
        }
        nextDepth(root)
        return root
    }

    static findRecurseAsync(dirname: string, fileOnly: boolean = true): Observable<FileStats> {
        return Observable.create((observer: Observer<FileStats>) => {
            let sub: SubscibeHelper = new SubscibeHelper()
            sub.observer = observer
            sub.add = tsfs.validateRoot(dirname).subscribe(
                (root: FileStats) => {
                    sub.unsubscribe()
                    tsfs._findRecurseAsync(root, observer, sub, fileOnly)
                },
                sub.error,
                () => {
                    sub.unsubscribe()
                    observer.complete
                }
            )
            return () => {
                sub.unsubscribe()
                sub.observer = undefined
            }
        })
    }

    private static _treeAsync(root: FileStats, observer: Observer<FileStatsTree>, sub: SubscibeHelper) {
        let tree: FileStatsTree = new FileStatsTree()
        let dirs: FileStats[] = [root]
        let depth: number = tsfs.dirDepth(root.path)
        tree[depth] = [root]
        let nextDir = () => {
            if (!dirs.length) {
                sub.observer = undefined
                observer.next(tree)
                observer.complete()
                return
            }
            let stats: FileStats = dirs.shift()
            let depth: number = tsfs.dirDepth(stats.path) + 1
            if (tree[depth] == undefined)
                tree[depth] = []

            sub.add = tsfs.readDirAsync(stats.path).subscribe(
                (fileStats: FileStats[]) => {
                    tree[depth] = tree[depth].concat(fileStats)
                    for (let stats of fileStats)
                        if (stats.stats.isDirectory()) {
                            dirs.push(stats)
                        }
                },
                sub.error,
                () => {
                    sub.unsubscribe()
                    nextDir()
                }
            )
        }
        nextDir()
    }

    private static _findRecurseAsync(root: FileStats, observer: Observer<FileStats>, sub: SubscibeHelper, fileOnly: boolean = true) {
        let searchBreak: boolean = false
        let dirs: FileStats[] = [root]
        let nextDir = () => {
            if (!dirs.length || searchBreak) {
                sub.unsubscribe()
                sub.observer = undefined
                if (!searchBreak)
                    observer.complete()
                return
            }
            let stats: FileStats = dirs.shift()
            sub.add = tsfs.findAsync(stats.path).subscribe(
                (fileStats: FileStats) => {
                    const isDir: boolean = fileStats.stats.isDirectory()
                    if (fileOnly) {
                        if (!isDir)
                            observer.next(fileStats)
                    }
                    else
                        observer.next(fileStats)

                    if (isDir)
                        dirs.push(fileStats)
                },
                sub.error,
                () => {
                    sub.unsubscribe()
                    nextDir()
                }
            )
        }
        nextDir()
    }

    static tree(dirname: string): Observable<FileStatsTree> {
        return Observable.create((observer: Observer<FileStatsTree>) => {

            const tree: FileStatsTree = new FileStatsTree()
            if (!fs.existsSync(dirname))
                return observer.error(new Error("File does not exists"))

            const root: FileStats = new FileStats(
                dirname,
                path.basename(dirname),
                fs.statSync(dirname))
            if (!root.stats.isDirectory())
                return observer.error(new Error("File must be a directory"))

            let depth: number = tsfs.dirDepth(root.path) - 1
            tree[depth] = [root]
            const dirs: FileStats[] = [root]

            let next = () => {
                if (dirs.length) {
                    try {
                        let stats: FileStats = dirs.shift()
                        depth = tsfs.dirDepth(stats.path)
                        if (tree[depth] == undefined)
                            tree[depth] = []
                        let files: FileStats[] = tsfs.readDir(stats.path)
                        for (let f of files) {
                            tree[depth].push(f)
                            if (f.stats.isDirectory()) {
                                dirs.push(f)
                            }
                        }
                        next()
                    } catch (e) {
                        return observer.error(e)
                    }
                }
                else {
                    observer.next(tree)
                    observer.complete()
                }
            }

            next()
        })
    }

    static readDir(dirname: string): FileStats[] {
        const result: FileStats[] = []
        const files: string[] = fs.readdirSync(dirname)
        let stats: FileStats
        let p: string
        for (const f of files) {
            p = path.join(dirname, f)
            result.push(new FileStats(p, f, fs.lstatSync(p)))
        }
        return result
    }

    static rm_rfAsync(dirname): Observable<boolean> { 
        return Observable.create((observer: Observer<boolean>) => {
            let sub: SubscibeHelper = new SubscibeHelper()
            sub.observer = observer
            sub.add = tsfs.treeAsync(dirname).subscribe(
                tree => {
                    sub.unsubscribe()
                    sub.add = tsfs.rmTreeAsync(tree).subscribe(
                        result => {
                            observer.next(result)
                        },
                        sub.error,
                        () => {
                            sub.unsubscribe()
                            sub.observer = undefined
                            observer.complete()
                        })
                },
                sub.error)
        })
    }
    static rm_rf(dirname): Observable<boolean> {
        return Observable.create((observer: Observer<boolean>) => {
            tsfs.tree(dirname).subscribe(
                tree => {
                    tsfs.rmTree(tree).subscribe(
                        result => {
                            observer.next(result)
                        },
                        error => {
                            observer.error(error)
                        },
                        () => {
                            observer.complete()
                        }).unsubscribe()
                },
                observer.error,
                observer.complete).unsubscribe()
        })
    }

    static rmTreeAsync(tree: FileStatsTree): Observable<boolean> {
        return Observable.create((observer: Observer<boolean>) => {
            let files: FileStats[] = []
            for (let index in tree) {
                if (tree[index] instanceof Array) {
                    files = files.concat(tree[index])
                    delete (tree[index])
                }
            }
            files.reverse()
            let next = (error?: NodeJS.ErrnoException) => {
                if(error) {
                    observer.error(error)
                    return
                }
                if(files.length) {
                    const file: FileStats = files.shift()
                    if(file.stats.isSymbolicLink() || file.stats.isFile()) {
                        fs.unlink(file.path, next)
                    }
                    else if(file.stats.isDirectory())
                        fs.rmdir(file.path, next)
                }
                else {
                    observer.next(true)
                    observer.complete()
                }
            }
            next()
        })
    }
    static rmTree(tree: FileStatsTree): Observable<boolean> {
        return Observable.create((observer: Observer<boolean>) => {
            try {
                let files: FileStats[] = []
                for (let index in tree) {
                    if (tree[index] instanceof Array) {
                        files = files.concat(tree[index])
                        delete (tree[index])
                    }
                }
                files.reverse()
                for (let f of files) {
                    if (f.stats.isSymbolicLink() || f.stats.isFile())
                        fs.unlinkSync(f.path)
                    else if (f.stats.isDirectory())
                        fs.rmdirSync(f.path)
                }
            } catch (e) {
                return observer.error(e)
            }
            observer.next(true)
            observer.complete()
        })
    }

    static validateRoot(dirname: string): Observable<FileStats> {
        return Observable.create((observer: Observer<FileStats>) => {

            let sub: SubscibeHelper = new SubscibeHelper()
            sub.observer = observer

            sub.add = tsfs.existsAsync(dirname).subscribe(
                exits => {
                    if (!exits)
                        sub.error(tsfs.notExitsError(dirname))
                },
                sub.error,
                () => {
                    sub.unsubscribe()
                    let root: FileStats
                    sub.add = tsfs.statsAsync(dirname).subscribe(
                        (fileStats: FileStats) => {
                            if (!fileStats.stats.isDirectory()) {
                                return sub.error(tsfs.notDirectoryError)
                            }
                            sub.unsubscribe()
                            observer.next(fileStats)
                            observer.complete()
                        },
                        sub.error
                    )
                }
            )
        })
    }

    static treeToString(tree: FileStatsTree) {
        console.log("treeToString --")
        let j: number = 0
        let depth: number = 0
        let t: string = ""
        for (let i in tree) {

            for (let f of tree[i]) {

                if (f.stats.isSymbolicLink()) {
                    let ls = fs.lstatSync(f.path)
                    let rls = fs.readlinkSync(f.path)
                    console.log(t, j, f.
                        basename, "=>", rls)
                }
                else console.log(t, j, f.basename)
            }
            t += "\t"
            j++
        }
        console.log("-- treeToString")
    }

    static toHtmlString(root: TreeItem): string {
        let getT = (t: number): string => {
            let s: string = ""
            for (let i = 0; i < t; i++)
                s += "\t"
            return s
        }
        let html: string[] = [`<ol>`]


        let nextHtml = (item: TreeItem, ti: number = 0) => {
            let t: string = getT(ti)
            let child: TreeItem

            html.push(`${t}<li>
${getT(ti + 1)}<a href="${item.stats.path}">${item.stats.basename}</a>`)
            if (item.dirs.length || item.files.length) {
                html.push(`${getT(ti + 1)}<ol>`)
                for (child of item.files) {
                    html.push(`${getT(ti + 2)}<li>
${getT(ti + 3)}<a href="${child.stats.path}">${child.stats.basename}</a>
${getT(ti + 2)}</li>`)
                }
                for (child of item.dirs)
                    nextHtml(child, ti + 2)
                html.push(`${getT(ti + 1)}</ol>`)
            }
            html.push(`${t}</li>`)
        }

        nextHtml(root, 1)
        html.push("</ol>")
        return html.join(os.EOL)
    }

    static notExitsError(path: string): Error {
        return new Error(`File does not exist : "${path}"`)
    }

    static get notDirectoryError(): Error {
        return new Error("Must be a directory")
    }

    static dirDepth(filename: string): number {
        return tsfs.splitPath(filename).length
    }

    static fileDepth(filename: string): number {
        return tsfs.dirDepth(filename) - 1
    }

    static splitPath(filename: string): string[] {
        return path.normalize(filename).split(pathSeparator)
    }
}