

## Problema

O menu sidebar abre corretamente no mobile (screenshot 1), mas ao selecionar uma opção e fechar o menu, a tela fica vazia (screenshot 2). O conteúdo existe mas não aparece.

A cadeia de containers é:
```text
<main> flex-1 min-h-0 overflow-hidden flex-col
  └─ <div> flex-1 min-h-0          ← sem overflow-y-auto!
       └─ <Outlet> (Reports etc.)  ← h-full overflow-y-auto
```

O problema: o `<div>` wrapper do Outlet tem `min-h-0` (correto para flex) mas **não tem overflow definido**. Combinado com `overflow-hidden` no `<main>`, o conteúdo fica preso sem poder rolar nem aparecer.

## Correção

**`src/App.tsx`** — Adicionar `overflow-y-auto` ao wrapper do Outlet:

```tsx
// Linha 52 — de:
<div className="flex-1 min-h-0 w-full relative">

// Para:
<div className="flex-1 min-h-0 w-full relative overflow-y-auto">
```

Isso permite que o conteúdo role dentro do espaço disponível, tanto no mobile quanto no desktop.

## Detalhes técnicos
- O `overflow-hidden` no `<main>` impede que o conteúdo "vaze" para fora do layout
- O `overflow-y-auto` no wrapper interno cria a área de scroll correta
- As páginas que já têm `h-full overflow-y-auto` (como Reports) continuarão funcionando normalmente

