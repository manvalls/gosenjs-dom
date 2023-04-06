import { Command, TransactionCommand } from '@gosen/command-types'

const onceSymbol = Symbol('gosen-once')
type GosenNode = Element | Document | DocumentFragment | HTMLTemplateElement

const mendScripts = (node: GosenNode) => {
  const scripts = getContainer(node).querySelectorAll('script')
  for (const script of scripts) {
    const newScript = document.createElement('script')
    for (const attr of script.attributes) {
      newScript.setAttribute(attr.name, attr.value)
    }
    newScript.textContent = script.textContent
    script.parentNode.replaceChild(newScript, script)
  }
}

const getContainer = (node: GosenNode) => {
  if ('content' in node) {
    return node.content
  }

  return node
}

const extractContent = (node: GosenNode) => {
  if ('content' in node) {
    return node.content
  }

  const fragment = document.createDocumentFragment()
  for (const child of node.childNodes) {
    fragment.appendChild(child)
  }

  return fragment
}

const runTransaction = async (root: GosenNode, tx: TransactionCommand) => {
  const nodes: Record<number, GosenNode[]> = {}
  const isContent: Record<number, boolean> = {}
  nodes[0] = [root]

  const w = 'defaultView' in root ? root.defaultView : root.ownerDocument?.defaultView || window
  const onceMap = (w[onceSymbol] || (w[onceSymbol] = {})) as Record<string, boolean>

  if (tx.once && onceMap[tx.hash]) {
    return
  }

  for (const subCommand of tx.tx) {
    if ('selector' in subCommand) {
      const parentNodes = nodes[subCommand.parent || 0] || []
      const result: Element[] = []

      for (const parentNode of parentNodes) {
        result.push(getContainer(parentNode).querySelector(subCommand.selector))
      }

      nodes[subCommand.id] = result
      continue
    }

    if ('selectorAll' in subCommand) {
      const parentNodes = nodes[subCommand.parent || 0] || []
      const result: Element[] = []

      for (const parentNode of parentNodes) {
        result.push(...getContainer(parentNode).querySelectorAll(subCommand.selectorAll))
      }

      nodes[subCommand.id] = result
      continue
    }

    if ('fragment' in subCommand) {
      const fr = document.createDocumentFragment()
      const div = document.createElement('div')
      div.innerHTML = subCommand.fragment
      for (const child of div.childNodes) {
        fr.appendChild(child)
      }

      nodes[subCommand.id] = [fr]
      continue
    }

    if ('content' in subCommand) {
      isContent[subCommand.id] = true
      nodes[subCommand.id] = nodes[subCommand.content]
      continue
    }

    if ('target' in subCommand) {
      if ('parent' in subCommand) {
        if (isContent[subCommand.target]) {
          nodes[subCommand.parent] = nodes[subCommand.target]
          continue
        }

        const result: GosenNode[] = []
        for (const node of nodes[subCommand.target]) {
          if (node.parentElement) {
            result.push(node.parentElement)
          }
        }

        nodes[subCommand.parent] = result
        continue
      }

      if ('firstChild' in subCommand) {
        const result: GosenNode[] = []
        for (const node of nodes[subCommand.target]) {
          const c = getContainer(node)
          if (c.children[0]) {
            result.push(c.children[0])
          }
        }

        nodes[subCommand.firstChild] = result
        continue
      }

      if ('lastChild' in subCommand) {
        const result: GosenNode[] = []
        for (const node of nodes[subCommand.target]) {
          const c = getContainer(node)
          if (c.children[c.children.length - 1]) {
            result.push(c.children[c.children.length - 1])
          }
        }

        nodes[subCommand.lastChild] = result
        continue
      }

      if ('nextSibling' in subCommand) {
        const result: GosenNode[] = []
        for (const node of nodes[subCommand.target]) {
          if ('nextElementSibling' in node && node.nextElementSibling) {
            result.push(node.nextElementSibling)
          }
        }

        nodes[subCommand.nextSibling] = result
        continue
      }

      if ('prevSibling' in subCommand) {
        const result: GosenNode[] = []
        for (const node of nodes[subCommand.target]) {
          if ('previousElementSibling' in node && node.previousElementSibling) {
            result.push(node.previousElementSibling)
          }
        }

        nodes[subCommand.prevSibling] = result
        continue
      }

      if ('text' in subCommand) {
        for (const node of nodes[subCommand.target]) {
          node.textContent = subCommand.text
        }
        continue
      }

      if ('html' in subCommand) {
        for (const node of nodes[subCommand.target]) {
          if ('innerHTML' in node) {
            node.innerHTML = subCommand.html
          } else if (node instanceof DocumentFragment) {
            const d = document.createElement('div')
            d.innerHTML = subCommand.html

            while (node.firstChild) {
              node.removeChild(node.firstChild)
            }

            for (const child of d.childNodes) {
              node.appendChild(child)
            }
          }

          mendScripts(node)
        }
        continue
      }

      if ('attr' in subCommand) {
        for (const node of nodes[subCommand.target]) {
          if ('setAttribute' in node) {
            node.setAttribute(subCommand.attr, subCommand.value)
          }
        }
        continue
      }

      if ('removeAttr' in subCommand) {
        for (const node of nodes[subCommand.target]) {
          if ('removeAttribute' in node) {
            node.removeAttribute(subCommand.removeAttr)
          }
        }
        continue
      }

      if ('addToAttr' in subCommand) {
        for (const node of nodes[subCommand.target]) {
          if ('getAttribute' in node) {
            const values = (node.getAttribute(subCommand.addToAttr) || '').split(/\s+/g)
            if (!values.includes(subCommand.value)) {
              values.push(subCommand.value)
            }

            node.setAttribute(subCommand.addToAttr, values.join(' '))
          }
        }
        continue
      }

      if ('removeFromAttr' in subCommand) {
        for (const node of nodes[subCommand.target]) {
          if ('getAttribute' in node) {
            const values = (node.getAttribute(subCommand.removeFromAttr) || '').split(/\s+/g)
            node.setAttribute(subCommand.removeFromAttr, values.filter((part) => part !== subCommand.value).join(' '))
          }
        }
        continue
      }

      if ('wait' in subCommand) {
        const p = new Promise<void>((resolve) => {
          let toWait = nodes[subCommand.target].length

          const listener = () => {
            toWait--
            if (toWait === 0) {
              resolve()
            }
          }

          for (const node of nodes[subCommand.target]) {
            node.addEventListener(subCommand.wait, listener, { once: true })
            Promise.resolve().then(() => p).then(() => node.removeEventListener(subCommand.wait, listener))
          }

          if (subCommand.timeout) {
            setTimeout(resolve, subCommand.timeout)
          }
        })
        
        await p
      }

      continue
    }

    if ('clone' in subCommand) {
      const result: GosenNode[] = []
      for (const node of nodes[subCommand.clone]) {
        result.push(node.cloneNode(true) as GosenNode)
      }

      nodes[subCommand.id] = result
      isContent[subCommand.id] = isContent[subCommand.clone]
      continue
    }

    if ('remove' in subCommand) {
      for (const node of nodes[subCommand.remove]) {
        if (node.parentElement) {
          node.parentElement.removeChild(node)
        }
      }
      continue
    }

    if ('insertNodeBefore' in subCommand) {
      loop: for (const parent of nodes[subCommand.parent]) {
        for (const ref of nodes[subCommand.ref]) {
          if (ref.parentElement === parent) {
            for (let node of nodes[subCommand.insertNodeBefore]) {
              if (nodes[subCommand.parent].length > 1) {
                node = node.cloneNode(true) as GosenNode
              }
              
              if (isContent[subCommand.insertNodeBefore]) {
                node = extractContent(node)
              }

              getContainer(parent).insertBefore(node, ref)
            }
            continue loop
          }
        }
      }
      continue
    }

    if ('insertBefore' in subCommand) {
      const d = document.createElement('div')
      d.innerHTML = subCommand.insertBefore

      const fragment = document.createDocumentFragment()
      for (const child of d.childNodes) {
        fragment.appendChild(child)
      }

      loop: for (const parent of nodes[subCommand.parent]) {
        for (const ref of nodes[subCommand.ref]) {
          if (ref.parentElement === parent) {
            const f = nodes[subCommand.parent].length > 1 ? fragment.cloneNode(true) : fragment
            mendScripts(f as GosenNode)
            getContainer(parent).insertBefore(f, ref)
            continue loop
          }
        }
      }

      continue
    }

    if ('appendNode' in subCommand) {
      for (const parent of nodes[subCommand.parent]) {
        for (let node of nodes[subCommand.appendNode]) {
          if (nodes[subCommand.parent].length > 1) {
            node = node.cloneNode(true) as GosenNode
          }
          
          if (isContent[subCommand.appendNode]) {
            node = extractContent(node)
          }

          getContainer(parent).appendChild(node)
        }
      }

      continue
    }

    if ('append' in subCommand) {
      const d = document.createElement('div')
      d.innerHTML = subCommand.append

      const fragment = document.createDocumentFragment()
      for (const child of d.childNodes) {
        fragment.appendChild(child)
      }

      for (const parent of nodes[subCommand.parent]) {
        const f = nodes[subCommand.parent].length > 1 ? fragment.cloneNode(true) : fragment
        mendScripts(f as GosenNode)
        getContainer(parent).appendChild(f)
      }

      continue
    }
  }

}

export const execute = async (root: GosenNode, commands: Command[]) => {
  const routines: Record<number, Promise<void>> = {}

  for (const command of commands) {
    if ('startRoutine' in command) {
      routines[command.startRoutine] = routines[command.routine || 0] || Promise.resolve()
      continue
    }

    if ('tx' in command) {
      routines[command.routine || 0] = (routines[command.routine || 0] || Promise.resolve()).then(() => runTransaction(root, command))
      continue
    }
  }

  await Promise.all(Object.values(routines))
}
