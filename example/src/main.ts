declare class Dependency {};
declare function inject(...args: any): any;

@inject
class Application {
  private readonly dependency!: Dependency;
}
