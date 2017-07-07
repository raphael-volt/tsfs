import * as chai from 'chai';
import * as sinon from 'sinon';
import * as mocha from 'mocha';
import * as path from "path";
import * as fs from "fs";
import { Observable, Observer, Subscription } from 'rxjs';
import { tsfs, FileStatsTree, FileStats, TreeItem } from '../src/tsfs';

const expect = chai.expect
const expectToBe = (value: any) => {
    return expect(value).to.be
}

const expectNotToBe = (value: any) => {
    return expect(value).not.to.be
}

const testDir: string = path.resolve(__dirname, "..", "tests")
if (!fs.existsSync(testDir))
    fs.mkdirSync(testDir)
const filename: string = path.join(testDir, "test-file.txt")
const dirname: string = path.join(testDir, "test-dir")

const deleteTree = () => {
    if (fs.existsSync(dirname))
        tsfs.rm_rf(dirname).subscribe(
            result => { },
            error => {
                throw error
            }
        ).unsubscribe()
}

const createTree = (depth: number = 3, symlink: boolean = true) => {
    deleteTree()
    let exist: boolean = fs.existsSync(dirname)
    if (exist)
        return

    let mkdir = (dir: string) => {
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir)
    }
    mkdir(dirname)
    depth = Math.min(depth, 3)
    let i: number
    let j: number
    let k: number
    const n: number = 3
    const m: number = 5

    let d1: string[] = ["A", "B", "C"]
    let d2: string[] = ["a", "b", "c"]
    let d3: string[] = ["1", "2", "3"]

    let createFile = (d: string) => {
        for (let j = 0; j < 5; j++) {
            let filename: string = path.join(d, `file-${j + 1}.txt`)
            fs.writeFileSync(
                filename,
                `file-${j + 1}.txt [${filename}]`
            )
        }
    }
    createFile(dirname)
    let dir: string
    if (depth > 0) {
        for (i = 0; i < n; i++) {
            dir = path.join(dirname, d1[i])
            mkdir(dir)
            createFile(dir)
            if (depth > 1) {
                for (j = 0; j < n; j++) {
                    dir = path.join(dirname, d1[i], d2[j])
                    mkdir(dir)
                    createFile(dir)
                    if (depth > 2) {
                        for (k = 0; k < n; k++) {
                            dir = path.join(dirname, d1[i], d2[j], d3[k])
                            mkdir(dir)
                            createFile(dir)
                        }
                    }
                }
            }
        }
    }
    if (symlink) {
        let target: string = dirname
        let src: string = "link"
        let names: string[] = ["A", "c", "1"]
        for (i = 0; i < depth; i++) {
            src += "-" + names[i]
            target = path.join(target, names[i])
        }
        src = path.join(dirname, src)
        fs.symlinkSync(
            target,
            src
        )
    }
}

describe('FileSystem', () => {

    before(() => {
        deleteTree()
    })

    after(() => {
        deleteTree()
    })

    describe('SYNC', () => {
        describe('tsfs', () => {
            let tree: FileStatsTree
            it("should create tree", () => {
                createTree()
                let complete: boolean
                let sub = tsfs.tree(dirname).subscribe(
                    result => {
                        tree = result
                    },
                    error => {
                        throw error
                    },
                    () => {
                        complete = true
                    })
                sub.unsubscribe()
                expectToBe(complete).true
            })
            it("should create the html tree", () => {
                let root: TreeItem = tsfs.hierarchicalTree(tree)
                let html = tsfs.toHtmlString(root)
                let filename: string = path.join(testDir, root.stats.basename + ".html")
                fs.writeFileSync(filename, html)
            })
            it("should delete tree", () => {
                deleteTree()
            })
        })
    })
    describe('ASYNC', () => {
        describe('tsfs', () => {
            it("should create tree", () => {
                createTree(3, true)
            })
            it("should read tree async", (done) => {
                tsfs.treeAsync(dirname).subscribe(tree => {
                    let count: number = 0
                    for (let i in tree)
                        count++
                    expectToBe(5).equals(count)
                    count = 0
                    for (let i in tree)
                        count += tree[i].length
                    expectToBe(241).equals(count)
                },
                    done,
                    done
                )
            })
            it("should find then unsubscribe", (done) => {
                let sub: Subscription = tsfs.findAsync(dirname).subscribe(
                    (stats: FileStats) => {
                        if (stats.basename == "file-3.txt") {
                            sub.unsubscribe()
                            done()
                        }
                    },
                    done,
                    () => {
                        done("SHOULD NOT BE CALLED")
                    })
            })
            it("should find recurse then unsubscribe", (done) => {
                let sub: Subscription = tsfs.findRecurseAsync(dirname).subscribe(
                    (stats: FileStats) => {
                        if (stats.basename == "file-3.txt" && path.basename(path.dirname(stats.path)) == "b") {
                            sub.unsubscribe()
                            done()
                        }
                    },
                    done,
                    () => {
                        done("SHOULD NOT BE CALLED")
                    }
                )
            })

            it("should create index.ts recursively", (done) => {
                let dir: string = path.resolve(__dirname, "..", "src")
                tsfs.generateTsIndex(dir).subscribe(
                    result => expectToBe(result).true,
                    done,
                    () => {
                        let files: string[] = []
                        tsfs.findRecurseAsync(dir, true).subscribe(
                            (fileStat: FileStats) => {
                                if (fileStat.basename == "index.ts")
                                    files.push(fileStat.path)
                            },
                            done,
                            () => {
                                expectToBe(files.length).equals(1)
                                done()
                            }
                        )
                    }
                )

            })

            it("should delete index.ts recursively", (done) => {
                let dir: string = path.resolve(__dirname, "..", "src")
                tsfs.deleteTsIndex(dir).subscribe(
                    result => expectToBe(result).true,
                    done,
                    () => {
                        let files: string[] = []
                        tsfs.findRecurseAsync(dir, true).subscribe(
                            (fileStat: FileStats) => {
                                if (fileStat.basename == "index.ts")
                                    files.push(fileStat.path)
                            },
                            done,
                            () => {
                                expectToBe(files.length).equals(0)
                                done()
                            }
                        )
                    }
                )
            })

            it("should delete tree async", (done) => {
                let sub = tsfs.rm_rfAsync(dirname).subscribe(
                    result => {
                        expectToBe(result).true
                        expectToBe(fs.existsSync(dirname)).false
                    },
                    done,
                    done
                )
            })
        })
    })
})