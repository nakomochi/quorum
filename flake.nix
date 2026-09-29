{
  description = "Quorum: Discord-authenticated form and attendance app";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            nodejs_22
            postgresql_16
            docker-compose
          ];

          shellHook = ''
            echo "Quorum devshell"
            echo "  bun $(bun --version) / node $(node --version)"
            echo "  docker compose up -d   # start postgres"
            echo "  bun install && bun run dev"
          '';
        };
      });
    };
}
