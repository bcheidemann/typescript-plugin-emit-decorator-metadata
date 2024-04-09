declare class Dependency {}
declare function inject(...args: any): any

class Application {
  @inject
  private readonly dependency!: Dependency;
}
