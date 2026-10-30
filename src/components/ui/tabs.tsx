"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { motion, useReducedMotion } from "framer-motion"

import { cn } from "@/lib/utils"

/**
 * Underline tabs with an animated sliding active indicator (spec §3).
 * Component API is unchanged — Radix props pass straight through; the
 * indicator slides via framer-motion layoutId scoped per TabsList.
 */

const TabsValueContext = React.createContext<string>("")
const TabsListIdContext = React.createContext<string>("")

function Tabs({
  className,
  value: valueProp,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const [internal, setInternal] = React.useState(defaultValue)
  const isControlled = valueProp !== undefined
  const value = isControlled ? valueProp : internal
  const handle = React.useCallback(
    (v: string) => {
      if (!isControlled) setInternal(v)
      onValueChange?.(v)
    },
    [isControlled, onValueChange]
  )
  return (
    <TabsValueContext.Provider value={value ?? ""}>
      <TabsPrimitive.Root
        data-slot="tabs"
        value={value}
        onValueChange={handle}
        className={cn("flex flex-col gap-2", className)}
        {...props}
      />
    </TabsValueContext.Provider>
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const id = React.useId()
  return (
    <TabsListIdContext.Provider value={id}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        className={cn(
          "inline-flex h-10 w-fit items-center gap-1 border-b bg-transparent p-0 text-muted-foreground",
          className
        )}
        {...props}
      />
    </TabsListIdContext.Provider>
  )
}

function TabsTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const activeValue = React.useContext(TabsValueContext)
  const listId = React.useContext(TabsListIdContext)
  const reduce = useReducedMotion()
  const isActive = activeValue !== "" && activeValue === props.value
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-t-md px-3 pb-2 pt-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-ink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      {isActive ? (
        <motion.span
          layoutId={`tabs-underline-${listId}`}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42 }}
          className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
          aria-hidden
        />
      ) : null}
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
