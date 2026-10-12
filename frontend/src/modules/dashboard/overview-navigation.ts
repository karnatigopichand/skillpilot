export function jumpToSection(id: string) {
  const heading = document.getElementById(id)
  heading?.focus({preventScroll: true})
  heading?.scrollIntoView({block: 'start'})
}
